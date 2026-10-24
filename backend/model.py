"""Nahda planning model: resource revenue, solar deals, rail costs, allocation, stress tests."""

from functools import lru_cache
from math import asin, cos, radians, sin, sqrt
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
YEARS = 10
SECTORS = ["solar", "rail", "fund"]
BENCHMARKS = ["NOR", "ARE", "BWA"]
FARM_MW = 500

# Every assumption the model uses: default, range, unit, and what it means. Editable in the app.
ASSUMPTIONS = {
    "solar_capex_per_mw": {"value": 800_000, "min": 600_000, "max": 1_100_000, "unit": "$/MW", "label": "Solar build cost",
                           "note": "Cost to build 1 MW of utility-scale solar, including grid connection."},
    "solar_om_per_mw": {"value": 15_000, "min": 8_000, "max": 25_000, "unit": "$/MW/yr", "label": "Solar running cost",
                        "note": "Yearly operations and maintenance per MW."},
    "performance_ratio": {"value": 0.80, "min": 0.75, "max": 0.85, "unit": "ratio", "label": "Performance ratio",
                          "note": "Share of the sun's energy that reaches the grid after heat, dust and wiring losses."},
    "degradation": {"value": 0.005, "min": 0.003, "max": 0.008, "unit": "/yr", "label": "Panel degradation",
                    "note": "Panels lose a little output every year."},
    "project_life": {"value": 25, "min": 20, "max": 30, "unit": "years", "label": "Project life",
                     "note": "How long the farm keeps producing."},
    "heat_rate": {"value": 9.5, "min": 7.5, "max": 11.0, "unit": "MMBtu/MWh", "label": "Fuel per MWh replaced",
                  "note": "Fuel burned per MWh by the plants solar replaces. Older oil and gas units burn more."},
    "fuel_value": {"value": 9.0, "min": 5.0, "max": 14.0, "unit": "$/MMBtu", "label": "Fuel export value",
                   "note": "Solar's value is the export value of the oil or gas no longer burned at home. $9/MMBtu is roughly oil at $52/bbl."},
    "residential_share": {"value": 0.35, "min": 0.15, "max": 0.6, "unit": "ratio", "label": "Homes' share of electricity",
                          "note": "Share of a country's electricity used by homes; the rest goes to business and industry. "
                                  "One home's use = electricity per person × people per household × this share."},
    "household_size": {"value": 4.5, "min": 1.5, "max": 10, "unit": "people", "label": "People per household",
                       "note": "Used to count households (population ÷ this). Default is an approximate regional average; Libya 6."},
    "kwh_per_new_person": {"value": 1_000, "min": 500, "max": 2_000, "unit": "kWh/yr", "label": "Use per new connection",
                           "note": "Electricity needed per person newly connected to the grid."},
    "rail_cost_per_km": {"value": 15_000_000, "min": 8_000_000, "max": 30_000_000, "unit": "$/km", "label": "Rail build cost",
                         "note": "Conventional intercity rail. Used to turn the rail allocation into kilometres."},
    "rail_route_factor": {"value": 1.25, "min": 1.1, "max": 1.4, "unit": "x", "label": "Route length factor",
                          "note": "Track runs longer than the straight line between two cities."},
    "base_discount_rate": {"value": 0.06, "min": 0.04, "max": 0.08, "unit": "rate", "label": "Base cost of capital",
                           "note": "Yearly return investors need on solar in a low-risk country such as Norway."},
    "risk_premium_per_point": {"value": 0.025, "min": 0.015, "max": 0.035, "unit": "rate/pt", "label": "Country risk premium",
                               "note": "Extra yearly return investors need per point the World Bank government-effectiveness score sits below Norway's."},
    "fund_return": {"value": 0.05, "min": 0.03, "max": 0.07, "unit": "rate", "label": "Fund real return",
                    "note": "Yearly real return of the savings fund, invested in a diversified global portfolio."},
    "solar_build_years": {"value": 1, "min": 1, "max": 3, "unit": "years", "label": "Solar build time",
                          "note": "Years from funding to a working solar farm."},
    "rail_build_years": {"value": 2, "min": 1, "max": 5, "unit": "years", "label": "Rail build time",
                         "note": "Years from funding to an open rail line."},
}

# Source labels for hover text: (indicator name, code)
INDICATOR_META = {
    "electricity_access_pct": ("Access to electricity, % of population", "World Bank EG.ELC.ACCS.ZS"),
    "renewable_electricity_pct": ("Renewable electricity output, % of total electricity output", "World Bank EG.ELC.RNEW.ZS"),
    "gdp_per_capita_usd": ("GDP per capita, current US$", "World Bank NY.GDP.PCAP.CD"),
    "oil_rents_pct_gdp": ("Oil rents, % of GDP", "World Bank NY.GDP.PETR.RT.ZS"),
    "gdp_usd": ("GDP, current US$", "World Bank NY.GDP.MKTP.CD"),
    "government_effectiveness": ("Government Effectiveness: Estimate (-2.5 to 2.5)", "World Bank WGI GOV_WGI_GE.EST"),
    "population": ("Population, total", "World Bank SP.POP.TOTL"),
    "kwh_per_person": ("Electric power consumption, kWh per capita", "World Bank EG.USE.ELEC.KH.PC"),
}
SOLAR_SOURCE = "NASA POWER ALLSKY_SFC_SW_DWN, annual climatology"


def params(overrides: dict | None = None, iso3: str | None = None) -> dict:
    """Assumption values, with user overrides clipped to each assumption's range.
    With a country, household size defaults to that country's regional average instead of the generic value."""
    overrides = dict(overrides or {})
    if iso3 and "household_size" not in overrides:
        overrides["household_size"] = default_household_size(iso3)
    out = {}
    for key, spec in ASSUMPTIONS.items():
        value = overrides.get(key, spec["value"])
        out[key] = float(min(max(value, spec["min"]), spec["max"]))
    return out


# Approximate average people per household by World Bank region (rounded from UN household-size data).
# These are planning defaults, editable in the app, not measurements of any one country.
HOUSEHOLD_SIZE_BY_REGION = {
    "Middle East & North Africa": 5.0,
    "Sub-Saharan Africa": 4.8,
    "South Asia": 4.8,
    "Latin America & Caribbean": 3.4,
    "East Asia & Pacific": 3.5,
    "Europe & Central Asia": 2.5,
    "North America": 2.5,
}
HOUSEHOLD_SIZE_BY_COUNTRY = {"LBY": 6.0}


@lru_cache(maxsize=None)
def default_household_size(iso3: str) -> float:
    if iso3 in HOUSEHOLD_SIZE_BY_COUNTRY:
        return HOUSEHOLD_SIZE_BY_COUNTRY[iso3]
    meta = pd.read_csv(DATA / "country_meta.csv").set_index("iso3")
    region = meta.region.get(iso3)
    return HOUSEHOLD_SIZE_BY_REGION.get(region, ASSUMPTIONS["household_size"]["value"])


def home_use_kwh(iso3: str, a: dict) -> float:
    """Yearly electricity of one home: national use per person × household size × homes' share."""
    kwh_pp = latest(iso3)["kwh_per_person"] or 1500.0
    return kwh_pp * a["household_size"] * a["residential_share"]


@lru_cache
def load():
    """panel: every country, unfilled (each value keeps its true year). sites: hand-picked NASA sites for
    11 countries. oil: Brent prices. The 11-country file still supplies governance scores."""
    panel = pd.read_csv(DATA / "panel_raw.csv").sort_values(["iso3", "year"])
    sites = pd.read_csv(DATA / "sites.csv")
    oil = pd.read_csv(DATA / "oil_prices.csv", parse_dates=["date"])
    return panel, sites, oil


@lru_cache
def extras():
    governance = pd.read_csv(DATA / "countries.csv")[["iso3", "year", "government_effectiveness", "group"]]
    solar = pd.read_csv(DATA / "country_solar.csv")
    return governance, solar


@lru_cache(maxsize=None)
def country_rows(iso3: str) -> pd.DataFrame:
    """One country's rows (cached; treat as read-only)."""
    panel, _, _ = load()
    return panel[panel.iso3 == iso3]


def has_sunlight(iso3: str) -> bool:
    return len(sites_for(iso3)) > 0


def known(iso3: str) -> bool:
    panel, _, _ = load()
    return iso3 in set(panel.iso3)


def series(iso3: str, col: str, years: int | None = None) -> list[dict]:
    s = country_rows(iso3)[["year", col]].dropna()
    if years:
        s = s[s.year > s.year.max() - years]
    return [{"year": int(y), "value": float(v)} for y, v in s.values]


@lru_cache(maxsize=None)
def latest(iso3: str) -> dict:
    """Latest measured value and its year, for every indicator (cached; treat as read-only)."""
    df = country_rows(iso3)
    governance, _ = extras()
    out = {"iso3": iso3, "country": str(df.country.iloc[0])}
    for col in df.columns.drop(["iso3", "country", "year"]):
        s = df[["year", col]].dropna()
        out[col] = None if s.empty else float(s[col].iloc[-1])
        out[f"{col}_year"] = None if s.empty else int(s.year.iloc[-1])
    g = governance[governance.iso3 == iso3].dropna(subset=["government_effectiveness"])
    out["government_effectiveness"] = float(g.government_effectiveness.iloc[-1]) if len(g) else None
    out["group"] = str(governance[governance.iso3 == iso3].group.iloc[0]) if iso3 in set(governance.iso3) else None
    return out


def sites_for(iso3: str) -> pd.DataFrame:
    """Hand-picked NASA sites where we have them; otherwise the NASA value at the country's center."""
    _, sites, _ = load()
    s = sites[sites.iso3 == iso3]
    if len(s):
        return s.sort_values("solar_kwh_m2_day", ascending=False)
    _, solar = extras()
    c = solar[solar.iso3 == iso3].copy()
    c["site"] = "Country center"
    return c


# ---------- Resource income ----------

RESOURCES = {
    "oil": ("oil_rents_pct_gdp", "oil"),
    "minerals": ("mineral_rents_pct_gdp", "mineral"),
    "coal": ("coal_rents_pct_gdp", "coal"),
    "gas_forest": ("gas_forest_rents_pct_gdp", "gas and forest"),
}


@lru_cache(maxsize=512)
def main_resource(iso3: str) -> str:
    """The resource with the largest rents (share of GDP) over the latest 5 years with data."""
    df = country_rows(iso3)
    avg = {k: df[col].dropna().tail(5).mean() for k, (col, _) in RESOURCES.items() if col in df}
    avg = {k: v for k, v in avg.items() if pd.notna(v)}
    return max(avg, key=avg.get) if avg else "oil"


def resource_word(iso3: str) -> str:
    return RESOURCES[main_resource(iso3)][1]


def revenue_history(iso3: str) -> list[dict]:
    """Resource income = GDP x rents share of the country's main resource, per year (World Bank)."""
    col = RESOURCES[main_resource(iso3)][0]
    df = country_rows(iso3).dropna(subset=["gdp_usd", col])
    return [
        {"year": int(r.year), "gdp_usd": float(r.gdp_usd), "oil_rents_pct": float(getattr(r, col)),
         "revenue": float(r.gdp_usd * getattr(r, col) / 100)}
        for r in df.itertuples()
    ]


def revenue_baseline(iso3: str) -> dict:
    hist = revenue_history(iso3)
    last5 = hist[-5:]
    last10 = hist[-10:]
    worst = min(last10, key=lambda r: r["revenue"])
    best = max(last10, key=lambda r: r["revenue"])
    drops = [(a, b) for a, b in zip(hist, hist[1:]) if a["year"] + 1 == b["year"]]
    drops = [d for d in drops if d[0]["revenue"] > 0]
    biggest_drop = min(drops, key=lambda d: d[1]["revenue"] / d[0]["revenue"]) if drops else None
    avg = float(np.mean([r["revenue"] for r in last5]))
    return {
        "avg": avg,
        "years": [r["year"] for r in last5],
        "used": last5,
        "history": hist[-15:],
        "worst": worst,
        "best": best,
        "biggest_drop": (
            {"from": biggest_drop[0], "to": biggest_drop[1],
             "change": biggest_drop[1]["revenue"] / biggest_drop[0]["revenue"] - 1}
            if biggest_drop else None
        ),
    }


# ---------- Cost of capital ----------

def discount_rate(iso3: str, a: dict) -> float:
    # The World Bank governance score is centered on 0 (world average); used where we lack a country's score
    ge = latest(iso3)["government_effectiveness"]
    ge = 0.0 if ge is None else ge
    ge_nor = latest("NOR")["government_effectiveness"]
    return a["base_discount_rate"] + a["risk_premium_per_point"] * max(0.0, ge_nor - ge)


# ---------- Solar deal ----------

def npv(rate: float, flows: list[float]) -> float:
    return float(sum(f / (1 + rate) ** t for t, f in enumerate(flows)))


def irr(flows: list[float]) -> float | None:
    lo, hi = -0.9, 1.5
    if npv(lo, flows) * npv(hi, flows) > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(lo, flows) * npv(mid, flows) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def payback(flows: list[float]) -> float | None:
    cum = flows[0]
    for t, f in enumerate(flows[1:], start=1):
        if cum + f >= 0:
            return t - 1 + (-cum / f)
        cum += f
    return None


def solar_flows(a: dict, solar_kwh: float, mw: float, capex_mult=1.0, fuel_mult=1.0) -> dict:
    capex = mw * a["solar_capex_per_mw"] * capex_mult
    mwh = mw * solar_kwh * 365 * a["performance_ratio"]
    value_per_mwh = a["heat_rate"] * a["fuel_value"] * fuel_mult
    om = mw * a["solar_om_per_mw"]
    yearly = [mwh * (1 - a["degradation"]) ** t * value_per_mwh - om for t in range(int(a["project_life"]))]
    return {"capex": capex, "mwh": mwh, "value_per_mwh": value_per_mwh, "om": om, "flows": [-capex, *yearly]}


def deal(iso3: str, site: str, mw: float, a: dict, capex_mult=1.0, fuel_mult=1.0, rate_shift=0.0) -> dict:
    row = sites_for(iso3).set_index("site").loc[site]
    kwh = float(row.solar_kwh_m2_day)
    base = solar_flows(a, kwh, mw, capex_mult, fuel_mult)
    rate = discount_rate(iso3, a) + rate_shift
    rate_nor = discount_rate("NOR", a) + rate_shift

    def irr_with(**changes):
        return irr(solar_flows({**a, **changes}, kwh, mw, capex_mult, fuel_mult)["flows"])

    low = irr_with(solar_capex_per_mw=ASSUMPTIONS["solar_capex_per_mw"]["max"], fuel_value=ASSUMPTIONS["fuel_value"]["min"])
    high = irr_with(solar_capex_per_mw=ASSUMPTIONS["solar_capex_per_mw"]["min"], fuel_value=ASSUMPTIONS["fuel_value"]["max"])

    # Which single assumption moves the IRR most across its range?
    swings = []
    for key in ["solar_capex_per_mw", "fuel_value", "heat_rate", "performance_ratio", "solar_om_per_mw", "degradation", "project_life"]:
        spec = ASSUMPTIONS[key]
        r_lo, r_hi = irr_with(**{key: spec["min"]}), irr_with(**{key: spec["max"]})
        swings.append({"key": key, "label": spec["label"], "unit": spec["unit"], "low_value": spec["min"],
                       "high_value": spec["max"], "irr_at_low": r_lo, "irr_at_high": r_hi,
                       "swing": abs((r_hi or 0) - (r_lo or 0))})
    swings.sort(key=lambda s: -s["swing"])

    national_mwh = latest(iso3)["population"] * (latest(iso3)["kwh_per_person"] or 1500) / 1000
    return {
        "site": site, "lat": float(row.lat), "lon": float(row.lon), "solar_kwh": kwh, "mw": mw,
        "capex": base["capex"], "annual_mwh": base["mwh"], "homes": base["mwh"] * 1000 / home_use_kwh(iso3, a),
        "share_of_national_use": base["mwh"] / national_mwh,
        "value_per_mwh": base["value_per_mwh"], "annual_value": base["mwh"] * base["value_per_mwh"],
        "annual_om": base["om"],
        "irr": irr(base["flows"]), "irr_low": low, "irr_high": high,
        "npv": npv(rate, base["flows"]), "discount_rate": rate,
        "npv_at_nor_rate": npv(rate_nor, base["flows"]), "nor_discount_rate": rate_nor,
        "payback": payback(base["flows"]),
        "sensitivity": swings,
    }


# ---------- Rail ----------

RAIL_TYPES = [
    {"type": "Conventional single-track (diesel)", "min": 8e6, "max": 15e6},
    {"type": "Double-track electrified", "min": 15e6, "max": 30e6},
    {"type": "High-speed", "min": 30e6, "max": 60e6},
]


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    h = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * 6371 * asin(sqrt(h))


def rail(iso3: str, a_city: str, b_city: str, a: dict, annual_rail_pool: float) -> dict:
    s = sites_for(iso3).set_index("site")
    straight = haversine_km(s.loc[a_city].lat, s.loc[a_city].lon, s.loc[b_city].lat, s.loc[b_city].lon)
    route = straight * a["rail_route_factor"]
    options = []
    for t in RAIL_TYPES:
        lo, hi = route * t["min"], route * t["max"]
        options.append({**t, "cost_min": lo, "cost_max": hi,
                        "years_min": lo / annual_rail_pool if annual_rail_pool else None,
                        "years_max": hi / annual_rail_pool if annual_rail_pool else None})
    return {"from": a_city, "to": b_city, "straight_km": straight, "route_km": route, "options": options}


# ---------- Allocation over 10 years ----------

def delay(spending: np.ndarray, years: int) -> np.ndarray:
    """Money spent in year t produces results in year t + years (construction time)."""
    out = np.zeros_like(spending)
    if years < YEARS:
        out[:, years:] = spending[:, : YEARS - years]
    return out


def main_route(iso3: str, a: dict) -> dict:
    """Rail goal: link the first two cities listed for the country (capital and next major city)."""
    _, sites, _ = load()
    s = sites[sites.iso3 == iso3]
    if len(s) < 2:
        return {"from": None, "to": None, "km": 1000.0, "coords": None}
    x, y = s.iloc[0], s.iloc[1]
    return {"from": x.site, "to": y.site, "km": haversine_km(x.lat, x.lon, y.lat, y.lon) * a["rail_route_factor"],
            "coords": [[float(x.lat), float(x.lon)], [float(y.lat), float(y.lon)]]}


def context(iso3: str, a: dict | None = None) -> dict:
    a = a or params(iso3=iso3)
    lat = latest(iso3)
    best = sites_for(iso3).iloc[0]
    kwh_pp = lat["kwh_per_person"] or 1500.0
    households = lat["population"] / a["household_size"]
    home_kwh = home_use_kwh(iso3, a)
    return {
        "population": lat["population"],
        "access0": lat["electricity_access_pct"] if lat["electricity_access_pct"] is not None else 100.0,
        "renew0": lat["renewable_electricity_pct"] or 0.0,
        "kwh_per_person": kwh_pp,
        "households": households,
        "home_kwh": home_kwh,
        # Homes' total use is a share of national demand, so homes and clean share share one denominator
        "household_mwh": households * home_kwh / 1000,
        "base_revenue": revenue_baseline(iso3)["avg"] if revenue_history(iso3) else 0.0,
        "best_site": best.site,
        "route": main_route(iso3, a),
    }


def normalize(split) -> np.ndarray:
    s = np.asarray([split.get(k, 0) for k in SECTORS] if isinstance(split, dict) else split, dtype=float)
    return s / s.sum() if s.sum() > 0 else np.array([1 / 3] * 3)


def simulate(ctx: dict, a: dict, share: float, split, solar_kwh: float,
             rev_factor: np.ndarray, fuel_mult=None, capex_mult: float = 1.0) -> dict:
    """10-year projection. rev_factor has shape (scenarios, YEARS); all outputs share that shape.
    The savings fund tops up solar and rail spending in years when revenue falls short of plan."""
    s = normalize(split)
    S = rev_factor.shape[0]
    fuel_mult = np.ones_like(rev_factor) if fuel_mult is None else fuel_mult
    base_pool = share * ctx["base_revenue"]
    project_share = s[0] + s[1]
    solar_of_projects = s[0] / project_share if project_share > 0 else 0.0
    committed = base_pool * project_share

    revenue = ctx["base_revenue"] * rev_factor
    pool = share * revenue
    z = lambda: np.zeros((S, YEARS))  # noqa: E731
    fund, returns, draw, shortfall, solar_spend, rail_spend = z(), z(), z(), z(), z(), z()
    bal = np.zeros(S)
    for t in range(YEARS):
        earned = bal * a["fund_return"]
        bal = bal + earned
        projects = pool[:, t] * project_share
        gap = np.maximum(0.0, committed - projects)
        d = np.minimum(bal, gap)
        bal = bal - d + pool[:, t] * s[2]
        spend = projects + d
        fund[:, t], returns[:, t], draw[:, t], shortfall[:, t] = bal, earned, d, gap - d
        solar_spend[:, t] = spend * solar_of_projects
        rail_spend[:, t] = spend * (1 - solar_of_projects)

    solar_mw = np.cumsum(delay(solar_spend, int(a["solar_build_years"])) / (a["solar_capex_per_mw"] * capex_mult), axis=1)
    mwh = solar_mw * solar_kwh * 365 * a["performance_ratio"]
    solar_value = mwh * a["heat_rate"] * a["fuel_value"] * fuel_mult - solar_mw * a["solar_om_per_mw"]
    rail_km = np.cumsum(delay(rail_spend, int(a["rail_build_years"])) / (a["rail_cost_per_km"] * capex_mult), axis=1)

    pop = ctx["population"]
    demand_mwh = pop * ctx["kwh_per_person"] / 1000
    renew = np.minimum(100.0, ctx["renew0"] + mwh / demand_mwh * 100)
    unconnected = pop * (100 - ctx["access0"]) / 100
    connected = np.minimum(mwh * 1000 / a["kwh_per_new_person"], unconnected)
    access = ctx["access0"] + connected / pop * 100

    goals = goal_progress(ctx, fund, renew, access, rail_km)
    return {
        "revenue": revenue, "pool": pool, "fund": fund, "fund_returns": returns, "fund_draw": draw,
        "shortfall": shortfall, "solar_spend": solar_spend, "rail_spend": rail_spend,
        "solar_mw": solar_mw, "solar_mwh": mwh, "solar_value": solar_value,
        # Homes powered can never exceed the number of homes; coverage above 1 means power left over for business
        "homes": np.minimum(mwh * 1000 / ctx["home_kwh"], ctx["households"]),
        "household_coverage": mwh / ctx["household_mwh"],
        "rail_km": rail_km,
        "renewable_pct": renew, "access_pct": access,
        "capital_deployed": np.cumsum(solar_spend + rail_spend, axis=1),
        "value_created": np.cumsum(solar_value + returns, axis=1),
        # "Stays funded": at least 90% of the planned solar and rail spending actually happens
        "fully_funded": shortfall.sum(axis=1) <= FUNDED_TOLERANCE * committed * YEARS + 1e-6,
        **goals,
    }


GOAL_KEYS = ["goal_power", "goal_clean", "goal_savings", "goal_rail"]


def goals_meta(ctx: dict) -> list[dict]:
    r = ctx["route"]
    rail = f"{r['from']} → {r['to']} ({r['km']:,.0f} km)" if r["from"] else f"{r['km']:,.0f} km of rail"
    return [
        {"key": "goal_power", "label": "Power for everyone", "target": "100% have electricity"},
        {"key": "goal_clean", "label": "Clean electricity", "target": "50% from renewables"},
        {"key": "goal_savings", "label": "Crash-proof savings", "target": "1 year of oil money saved"},
        {"key": "goal_rail", "label": "Rail link", "target": rail},
    ]


def goal_progress(ctx: dict, fund, renew, access, rail_km) -> dict:
    """Progress toward each goal, 0-1 (1 = met). goal_score = average, 0-100."""
    g = {
        "goal_power": np.asarray(access) / 100,
        "goal_clean": np.asarray(renew) / 50,
        "goal_savings": np.asarray(fund) / max(ctx["base_revenue"], 1.0),
        "goal_rail": np.asarray(rail_km) / ctx["route"]["km"],
    }
    g = {k: np.minimum(1.0, v) for k, v in g.items()}
    g["goal_score"] = 100 * sum(g.values()) / 4
    return g


def goals_today(ctx: dict) -> dict:
    g = goal_progress(ctx, np.zeros(1), np.array([ctx["renew0"]]), np.array([ctx["access0"]]), np.zeros(1))
    return {k: float(v[0]) for k, v in g.items()}


def rows(result: dict, i: int = 0) -> list[dict]:
    keys = [k for k, v in result.items() if isinstance(v, np.ndarray) and v.ndim == 2]
    return [{"year": t + 1, **{k: float(result[k][i, t]) for k in keys}} for t in range(YEARS)]


# ---------- Oil price scenarios and shocks ----------

def revenue_scenarios(iso3: str, n: int = 500, block: int = 3, seed: int = 42) -> np.ndarray:
    """Oil-income paths as a ratio to the 5-year average: '500 futures built from real history'.
    Block bootstrap: replays random 3-year stretches of the country's own yearly oil-income changes,
    so booms and crashes keep their real shape. Each year the level drifts 30% back toward normal."""
    hist = revenue_history(iso3)
    changes = np.array([np.log(b["revenue"] / a["revenue"]) for a, b in zip(hist, hist[1:])
                        if b["year"] == a["year"] + 1 and a["revenue"] > 0 and b["revenue"] > 0])
    if len(changes) < block:
        return np.ones((n, YEARS))  # too little history to resample: income held steady
    changes -= changes.mean()  # no built-in trend up or down
    blocks = np.array([changes[i:i + block] for i in range(len(changes) - block + 1)])
    rng = np.random.default_rng(seed)
    draws = blocks[rng.integers(0, len(blocks), size=(n, -(-YEARS // block)))].reshape(n, -1)[:, :YEARS]
    level = np.zeros(n)
    out = np.empty((n, YEARS))
    for t in range(YEARS):
        level = 0.7 * level + draws[:, t]
        out[:, t] = level
    return np.exp(out)


def revenue_history_years(iso3: str) -> str:
    hist = revenue_history(iso3)
    return f"{hist[0]['year']}–{hist[-1]['year']}" if hist else "no"


SHOCKS = {
    "oil_price": {"label": "Oil price crash", "detail": "Oil and gas prices stay 40% lower for all 10 years."},
    "shutdown": {"label": "Production shutdown", "detail": "Oil output falls 70% for one year, then recovers."},
    "capex": {"label": "Costs run over budget", "detail": "Solar farms and rail cost 25% more to build."},
}

FUNDED_TOLERANCE = 0.10  # a plan stays funded if no more than 10% of planned project spending is missed

SITE_CAP_MW = 2000  # most solar any one site gets in the map view


def allocate_sites(iso3: str, total_mw: float) -> list[dict]:
    """Estimate where solar gets built: sunniest sites first, up to SITE_CAP_MW each (the last site takes the rest)."""
    sites = list(sites_for(iso3).itertuples())
    out, left = [], total_mw
    for i, s in enumerate(sites):
        mw = left if i == len(sites) - 1 else min(left, SITE_CAP_MW)
        left -= mw
        out.append({"site": s.site, "lat": float(s.lat), "lon": float(s.lon), "solar": float(s.solar_kwh_m2_day), "mw": mw})
    return out


def shock_inputs(name: str | None) -> dict:
    rev = np.ones((1, YEARS))
    fuel = np.ones((1, YEARS))
    out = {"capex_mult": 1.0, "rate_shift": 0.0}
    if name == "oil_price":
        rev, fuel = rev * 0.6, fuel * 0.6
    elif name == "shutdown":
        rev[0, 0] = 0.3
    elif name == "capex":
        out["capex_mult"] = 1.25
    elif name == "rates":
        out["rate_shift"] = 0.02
    return {"rev_factor": rev, "fuel_mult": fuel, **out}


def percentile_bands(values: np.ndarray) -> list[dict]:
    p10, p50, p90 = np.percentile(values, [10, 50, 90], axis=0)
    return [{"year": t + 1, "p10": float(p10[t]), "p50": float(p50[t]), "p90": float(p90[t])} for t in range(YEARS)]


