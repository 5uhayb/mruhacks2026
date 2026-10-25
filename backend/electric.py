"""Electrification planner: budget, solar / wind / grid & storage plan, recommendation, peer playbook, stress tests.

Every number is cached data (World Bank, NASA POWER) or an editable assumption labelled "estimate".
Nothing here is specific to any one country."""

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

import model

DATA = Path(__file__).parent / "data"
YEARS = 10
BUCKETS = ["solar", "wind", "grid", "reserve"]
BUCKET_LABELS = {"solar": "Solar farms", "wind": "Wind farms", "grid": "Grid, transmission & storage", "reserve": "Reserve fund"}
# Spending ramps up over the 10 years instead of all at once (the shares add up to 10 years of budget)
PHASE = np.array([0.5, 0.7, 0.9, 1.05, 1.1, 1.1, 1.15, 1.15, 1.15, 1.2])
METHOD = ("Allocated like an investment portfolio: more budget where energy returns are higher and safer, "
          "with diversification limits so no single bet dominates.")

ASSUMPTIONS = {
    # Budget
    "budget_gdp_share": {"group": "Budget", "value": 0.01, "min": 0.0, "max": 0.05, "unit": "rate", "label": "Budget: share of GDP (estimate)",
                         "note": "Yearly electrification budget as a share of GDP."},
    "budget_resource_share": {"group": "Budget", "value": 0.10, "min": 0.0, "max": 0.3, "unit": "rate", "label": "Budget: share of resource income (estimate)",
                              "note": "Added where the country earns natural resource income (World Bank rents)."},
    # Solar
    "solar_capex_per_mw": {"group": "Solar farms", "value": 800_000, "min": 500_000, "max": 1_300_000, "unit": "$/MW", "label": "Solar build cost (estimate)",
                           "note": "Utility-scale solar including grid connection."},
    "solar_om_per_mw": {"group": "Solar farms", "value": 15_000, "min": 8_000, "max": 30_000, "unit": "$/MW/yr", "label": "Solar running cost (estimate)",
                        "note": "Yearly operations and maintenance per MW."},
    "performance_ratio": {"group": "Solar farms", "value": 0.80, "min": 0.70, "max": 0.85, "unit": "ratio", "label": "Solar performance ratio (estimate)",
                          "note": "Share of sunlight energy that reaches the grid after heat, dust and wiring losses."},
    "solar_build_years": {"group": "Solar farms", "value": 1, "min": 1, "max": 3, "unit": "years", "label": "Solar build time (estimate)",
                          "note": "Years from funding to a working farm."},
    # Wind
    "wind_capex_per_mw": {"group": "Wind farms", "value": 1_300_000, "min": 900_000, "max": 2_000_000, "unit": "$/MW", "label": "Wind build cost (estimate)",
                          "note": "Onshore wind including grid connection."},
    "wind_om_per_mw": {"group": "Wind farms", "value": 40_000, "min": 20_000, "max": 70_000, "unit": "$/MW/yr", "label": "Wind running cost (estimate)",
                       "note": "Yearly operations and maintenance per MW."},
    "mw_per_turbine": {"group": "Wind farms", "value": 3.0, "min": 1.0, "max": 7.0, "unit": "MW", "label": "MW per turbine (estimate)",
                       "note": "Used only to turn MW into an approximate turbine count."},
    "wind_cf_slope": {"group": "Wind farms", "value": 0.087, "min": 0.05, "max": 0.12, "unit": "per m/s", "label": "Wind capacity factor slope (estimate)",
                      "note": "Rule of thumb: capacity factor ≈ slope × wind speed + intercept, capped at 0–50%."},
    "wind_cf_intercept": {"group": "Wind farms", "value": -0.278, "min": -0.5, "max": 0.0, "unit": "ratio", "label": "Wind capacity factor intercept (estimate)",
                          "note": "See the slope. 50 m point speeds are rough; turbine sites need detailed local studies."},
    "wind_build_years": {"group": "Wind farms", "value": 2, "min": 1, "max": 4, "unit": "years", "label": "Wind build time (estimate)",
                         "note": "Years from funding to working turbines."},
    # Grid & storage
    "line_cost_per_km": {"group": "Grid & storage", "value": 40_000, "min": 15_000, "max": 150_000, "unit": "$/km", "label": "Distribution line cost (estimate)",
                         "note": "Medium and low voltage line per km, including transformers."},
    "households_per_km": {"group": "Grid & storage", "value": 25, "min": 5, "max": 100, "unit": "homes/km", "label": "Homes connected per km (estimate)",
                          "note": "Households reached per km of new line; lower in sparse rural areas."},
    "battery_cost_per_mwh": {"group": "Grid & storage", "value": 300_000, "min": 150_000, "max": 600_000, "unit": "$/MWh", "label": "Battery cost (estimate)",
                             "note": "Installed battery storage per MWh of capacity."},
    "storage_share": {"group": "Grid & storage", "value": 0.30, "min": 0.0, "max": 0.7, "unit": "ratio", "label": "Storage share of grid budget (estimate)",
                      "note": "Solar and wind are variable; storage covers gaps between sun, wind and demand."},
    "grid_build_years": {"group": "Grid & storage", "value": 1, "min": 1, "max": 3, "unit": "years", "label": "Grid build time (estimate)",
                         "note": "Years from funding to energized lines."},
    # Demand and value
    "household_size": {"group": "Demand & value", "value": 4.5, "min": 1.5, "max": 10, "unit": "people", "label": "People per household (estimate)",
                       "note": "Default is an approximate regional average."},
    "kwh_per_new_person": {"group": "Demand & value", "value": 500, "min": 200, "max": 2_000, "unit": "kWh/yr", "label": "Use per newly connected person (estimate)",
                           "note": "Electricity a newly connected person uses each year."},
    "value_per_mwh": {"group": "Demand & value", "value": 85, "min": 40, "max": 250, "unit": "$/MWh", "label": "Value of each MWh (estimate)",
                      "note": "Cost of the power it replaces (often diesel or gas generation); sets paybacks."},
    "max_variable_share": {"group": "Demand & value", "value": 0.6, "min": 0.2, "max": 1.0, "unit": "ratio", "label": "Max solar + wind share of demand (estimate)",
                           "note": "Solar and wind are variable; beyond this share of demand, extra output is curtailed without large seasonal storage."},
    # Portfolio guardrails (editable)
    "single_source_cap": {"group": "Portfolio guardrails", "value": 0.40, "min": 0.2, "max": 1.0, "unit": "ratio",
                          "label": "Most for solar or wind alone", "note": "Neither solar nor wind gets more than this share of the budget on its own."},
    "lines_floor": {"group": "Portfolio guardrails", "value": 0.25, "min": 0.0, "max": 0.6, "unit": "ratio",
                    "label": "Least for grid lines", "note": "Power lines get at least this share whenever solar + wind exceed 30% of the budget."},
    "storage_floor": {"group": "Portfolio guardrails", "value": 0.10, "min": 0.0, "max": 0.3, "unit": "ratio",
                      "label": "Least for battery storage", "note": "Storage gets at least this share whenever solar + wind exceed 30% of the budget."},
    "reserve_share": {"group": "Portfolio guardrails", "value": 0.12, "min": 0.0, "max": 0.3, "unit": "ratio",
                      "label": "Reserve fund", "note": "Contingency for cost overruns and lean budget years; the safe range is 10–15%."},
    "solar_risk": {"group": "Portfolio guardrails", "value": 0.15, "min": 0.0, "max": 1.0, "unit": "ratio", "label": "Solar risk (estimate)",
                   "note": "Cost overrun and output variability; returns are divided by 1 + this risk."},
    "wind_risk": {"group": "Portfolio guardrails", "value": 0.30, "min": 0.0, "max": 1.0, "unit": "ratio", "label": "Wind risk (estimate)",
                  "note": "Wind costs and output vary more than solar; returns are divided by 1 + this risk."},
    # Recommendation thresholds
    "solar_threshold": {"group": "Thresholds", "value": 5.5, "min": 3.5, "max": 7.0, "unit": "kWh/m²/day", "label": "High solar potential from",
                        "note": "Best site's sunlight at or above this gets the High solar badge."},
    "wind_threshold": {"group": "Thresholds", "value": 6.5, "min": 4.0, "max": 9.0, "unit": "m/s", "label": "Promising wind from",
                       "note": "Best site's 50 m wind speed at or above this gets the Promising wind badge."},
}


def params(overrides: dict | None = None, iso3: str | None = None) -> dict:
    overrides = dict(overrides or {})
    if iso3 and "household_size" not in overrides:
        overrides["household_size"] = model.default_household_size(iso3)
    return {k: float(min(max(overrides.get(k, s["value"]), s["min"]), s["max"])) for k, s in ASSUMPTIONS.items()}


# ---------- Data ----------

@lru_cache
def sites() -> pd.DataFrame:
    return pd.read_csv(DATA / "energy_sites.csv")


@lru_cache
def access_detail() -> pd.DataFrame:
    return pd.read_csv(DATA / "electricity.csv")


def latest_value(df: pd.DataFrame, iso3: str, col: str) -> dict:
    s = df[df.iso3 == iso3][["year", col]].dropna() if col in df else pd.DataFrame()
    return {"value": float(s[col].iloc[-1]), "year": int(s.year.iloc[-1])} if len(s) else {"value": None, "year": None}


def resources(iso3: str) -> dict:
    """Best solar and wind across the country's cached NASA POWER points, each with its site name."""
    s = sites()[sites().iso3 == iso3]
    if s.empty:
        return {"solar": None, "wind": None, "sites": []}
    sun, wind = s.loc[s.solar_kwh_m2_day.idxmax()], s.loc[s.wind_50m_ms.idxmax()]
    return {
        "solar": {"value": float(sun.solar_kwh_m2_day), "site": str(sun.site), "lat": float(sun.lat), "lon": float(sun.lon)},
        "wind": {"value": float(wind.wind_50m_ms), "site": str(wind.site), "lat": float(wind.lat), "lon": float(wind.lon)},
        "sites": [{"site": str(r.site), "lat": float(r.lat), "lon": float(r.lon), "solar": float(r.solar_kwh_m2_day),
                   "wind": float(r.wind_50m_ms)} for r in s.itertuples()],
    }


SNAPSHOT_RULE = ("Snapshot year: the most recent year in which total, urban and rural electricity access and the clean share "
                 "all have real World Bank data. If that year is more than 5 years older than the latest year with total access "
                 "and clean share, the snapshot uses that newer year and marks urban or rural access as having no data then. "
                 "Every baseline uses the snapshot year; newer figures are shown separately.")
STALE_YEARS = 5


@lru_cache(maxsize=None)
def merged(iso3: str) -> pd.DataFrame:
    """One country's World Bank rows with urban and rural access joined in, by year (unfilled)."""
    rows = model.country_rows(iso3)
    detail = access_detail()
    return rows.merge(detail[detail.iso3 == iso3].drop(columns="iso3"), on="year", how="left").sort_values("year")


SNAPSHOT_COLUMNS = {"access": "electricity_access_pct", "urban": "urban_access_pct", "rural": "rural_access_pct",
                    "clean": "renewable_electricity_pct"}


@lru_cache(maxsize=None)
def snapshot_year(iso3: str) -> int | None:
    m = merged(iso3)
    full = m.dropna(subset=list(SNAPSHOT_COLUMNS.values()))
    core = m.dropna(subset=[SNAPSHOT_COLUMNS["access"], SNAPSHOT_COLUMNS["clean"]])
    full_year = int(full.year.max()) if len(full) else None
    core_year = int(core.year.max()) if len(core) else None
    if full_year is None or (core_year is not None and core_year - full_year > STALE_YEARS):
        return core_year  # urban or rural access stopped being measured long ago: don't anchor everything to then
    return full_year


def at(iso3: str, col: str, year: int | None) -> dict:
    """Value in `year` (or the latest at or before it); with year None, the latest value."""
    s = merged(iso3)[["year", col]].dropna() if col in merged(iso3) else pd.DataFrame(columns=["year", col])
    if year is not None:
        s = s[s.year <= year]
    return {"value": float(s[col].iloc[-1]), "year": int(s.year.iloc[-1])} if len(s) else {"value": None, "year": None}


def profile(iso3: str) -> dict:
    """Every metric at the country's snapshot year; a newer figure, where one exists, is kept as a separate note."""
    snap = snapshot_year(iso3)
    out = {"year": snap, "rule": SNAPSHOT_RULE, "resources": resources(iso3)}
    for key, col in SNAPSHOT_COLUMNS.items():
        base, newest = at(iso3, col, snap), at(iso3, col, None)
        if snap is not None and base["year"] is not None and base["year"] != snap:
            # No value in the snapshot year itself: say when it was last measured instead of mixing years
            base = {"value": None, "year": None, "last_measured": base["year"]}
        out[key] = {**base, "latest": newest if snap is not None and newest["year"] and newest["year"] > snap else None}
    return out


def budget(iso3: str, a: dict) -> dict:
    """Yearly budget = GDP x share, plus resource income x share where the country has resource income.
    Both at the snapshot year: GDP of that year, resource income averaged over the 5 years up to it."""
    snap = snapshot_year(iso3)
    g = at(iso3, "gdp_usd", snap)
    gdp = g["value"] or 0.0
    hist = [r for r in model.revenue_history(iso3) if snap is None or r["year"] <= snap][-5:]
    res = {"avg": float(np.mean([r["revenue"] for r in hist])), "years": [r["year"] for r in hist]} if hist else None
    res_avg = res["avg"] if res else 0.0
    parts = {
        "gdp": {"base": gdp, "year": g["year"], "share": a["budget_gdp_share"], "amount": gdp * a["budget_gdp_share"]},
        "resource": {"base": res_avg, "years": [res["years"][0], res["years"][-1]] if res else None,
                     "word": model.resource_word(iso3), "share": a["budget_resource_share"],
                     "amount": res_avg * a["budget_resource_share"]},
    }
    return {**parts, "total": parts["gdp"]["amount"] + parts["resource"]["amount"]}


def context(iso3: str, a: dict) -> dict:
    """Baseline at the snapshot year."""
    snap = snapshot_year(iso3)
    r = resources(iso3)
    pop = at(iso3, "population", snap)["value"] or model.latest(iso3)["population"]
    access = at(iso3, "electricity_access_pct", snap)["value"]
    kwh = at(iso3, "kwh_per_person", snap)["value"]
    return {
        "year": snap,
        "population": pop,
        "access0": access if access is not None else 100.0,
        "renew0": at(iso3, "renewable_electricity_pct", snap)["value"] or 0.0,
        "demand_mwh": pop * (kwh or 1500.0) / 1000,
        "solar": r["solar"]["value"] if r["solar"] else 0.0,
        "wind": r["wind"]["value"] if r["wind"] else 0.0,
    }


# ---------- Plan ----------

def wind_cf(a: dict, speed: float) -> float:
    return float(np.clip(a["wind_cf_slope"] * speed + a["wind_cf_intercept"], 0.0, 0.5))


def delay(spend: np.ndarray, years: int) -> np.ndarray:
    out = np.zeros_like(spend)
    if years < YEARS:
        out[:, years:] = spend[:, : YEARS - years]
    return out


def normalize(split) -> np.ndarray:
    s = np.asarray([split.get(k, 0) for k in BUCKETS] if isinstance(split, dict) else split, dtype=float)
    return s / s.sum() if s.sum() > 0 else np.full(len(BUCKETS), 1 / len(BUCKETS))


def grid_parts(a: dict, s: np.ndarray) -> tuple[float, float]:
    """Split the grid bucket into lines and storage (shares of the whole budget). Storage takes its usual share of the
    bucket, but when solar + wind exceed 30% it gets at least the storage floor, without pushing lines below theirs."""
    grid = s[2]
    storage = grid * a["storage_share"]
    if s[0] + s[1] > 0.30:
        lo, hi = a["storage_floor"], grid - a["lines_floor"]
        if lo <= hi + 1e-9:  # tolerance: 0.35 - 0.25 is a hair under 0.10 in floating point
            storage = float(np.clip(storage, lo, hi))
    return grid - storage, storage


def simulate(ctx: dict, a: dict, yearly_budget: float, split, factor: np.ndarray, capex_mult: float = 1.0, extra_delay: int = 0) -> dict:
    """10 years of phased building. factor: (scenarios, YEARS) multiplier on the budget. The reserve fund tops up
    project spending when the budget falls short or costs run over. New people get power only where both a line
    reaches them and new generation can supply them."""
    s = normalize(split)
    lines_share, storage_share = grid_parts(a, s)
    money = yearly_budget * factor * PHASE
    project_share = 1 - s[3]
    planned = yearly_budget * PHASE * project_share * capex_mult  # money needed to build the planned amounts
    actual = money * project_share
    S = factor.shape[0]
    reserve, drawn = np.zeros((S, YEARS)), np.zeros((S, YEARS))
    bal = np.zeros(S)
    spend = np.zeros((S, YEARS))
    for t in range(YEARS):
        bal = bal + money[:, t] * s[3]
        d = np.minimum(bal, np.maximum(0.0, planned[t] - actual[:, t]))
        bal = bal - d
        spend[:, t] = actual[:, t] + d
        reserve[:, t], drawn[:, t] = bal, d
    part = lambda x: spend * x / project_share if project_share > 0 else np.zeros_like(spend)  # noqa: E731
    solar_mw = np.cumsum(delay(part(s[0]), int(a["solar_build_years"]) + extra_delay) / (a["solar_capex_per_mw"] * capex_mult), axis=1)
    wind_mw = np.cumsum(delay(part(s[1]), int(a["wind_build_years"]) + extra_delay) / (a["wind_capex_per_mw"] * capex_mult), axis=1)
    line_km = np.cumsum(delay(part(lines_share), int(a["grid_build_years"]) + extra_delay) / (a["line_cost_per_km"] * capex_mult), axis=1)
    storage_mwh = np.cumsum(delay(part(storage_share), int(a["grid_build_years"]) + extra_delay) / (a["battery_cost_per_mwh"] * capex_mult), axis=1)

    solar_mwh = solar_mw * ctx["solar"] * 365 * a["performance_ratio"]
    wind_mwh = wind_mw * 8760 * wind_cf(a, ctx["wind"])
    pop = ctx["population"]
    unconnected = pop * (100 - ctx["access0"]) / 100
    reachable = line_km * a["households_per_km"] * a["household_size"]
    suppliable = (solar_mwh + wind_mwh) * 1000 / a["kwh_per_new_person"]
    connected = np.minimum(np.minimum(reachable, suppliable), unconnected)
    return {
        "spend": spend, "solar_mw": solar_mw, "wind_mw": wind_mw, "line_km": line_km, "storage_mwh": storage_mwh,
        "solar_mwh": solar_mwh, "wind_mwh": wind_mwh, "people_connected": connected,
        "limit": np.where(reachable <= suppliable, "lines", "generation"),
        "access_pct": np.minimum(100.0, ctx["access0"] + connected / pop * 100),
        "clean_pct": np.minimum(100.0, ctx["renew0"] + np.minimum((solar_mwh + wind_mwh) / ctx["demand_mwh"], a["max_variable_share"]) * 100),
        "solar_capex": np.cumsum(part(s[0]), axis=1), "wind_capex": np.cumsum(part(s[1]), axis=1),
        "grid_capex": np.cumsum(part(s[2]), axis=1), "reserve": reserve, "reserve_drawn": np.cumsum(drawn, axis=1),
        "lines_share": lines_share, "storage_share": storage_share,
    }


def phased(yearly_budget: float, split) -> list[dict]:
    """Planned spending per year and bucket (base case), for the phased spending bar."""
    s = normalize(split)
    return [{"year": t + 1, **{k: float(yearly_budget * PHASE[t] * s[i]) for i, k in enumerate(BUCKETS)}} for t in range(YEARS)]


def guardrails(a: dict, split) -> list[str]:
    """Plain warnings when a split leaves the safe portfolio limits."""
    s = normalize(split)
    lines, storage = grid_parts(a, s)
    cap = a["single_source_cap"] * 100
    out = []
    for i, name in [(0, "Solar"), (1, "Wind")]:
        if s[i] * 100 > cap + 0.5:
            out.append(f"{name} is {s[i] * 100:.0f}% of the budget, above the {cap:.0f}% single-source limit: one bad year for {name.lower()} would hit the whole plan.")
    if s[0] + s[1] > 0.30:
        if lines * 100 < a["lines_floor"] * 100 - 0.5:
            out.append(f"Grid lines get {lines * 100:.0f}%, below the {a['lines_floor'] * 100:.0f}% floor: new power may not reach homes.")
        if storage * 100 < a["storage_floor"] * 100 - 0.5:
            out.append(f"Battery storage gets {storage * 100:.0f}%, below the {a['storage_floor'] * 100:.0f}% floor: solar and wind power would be lost at night and on calm days.")
    if not 0.095 <= s[3] <= 0.155:
        out.append(f"The reserve is {s[3] * 100:.0f}%, outside the safe 10–15% range: "
                   + ("too little to absorb cost overruns." if s[3] < 0.10 else "money sits idle that could build power."))
    return out


def paybacks(a: dict, ctx: dict) -> dict:
    solar_net = ctx["solar"] * 365 * a["performance_ratio"] * a["value_per_mwh"] - a["solar_om_per_mw"]
    wind_net = 8760 * wind_cf(a, ctx["wind"]) * a["value_per_mwh"] - a["wind_om_per_mw"]
    return {"solar": a["solar_capex_per_mw"] / solar_net if solar_net > 0 else None,
            "wind": a["wind_capex_per_mw"] / wind_net if wind_net > 0 else None,
            "wind_cf": wind_cf(a, ctx["wind"])}


# ---------- Recommendation and peer playbook ----------

def sun_word(v: float, a: dict) -> str:
    return ("very strong sunlight" if v >= a["solar_threshold"] + 0.5 else "strong sunlight" if v >= a["solar_threshold"]
            else "moderate sunlight" if v >= 4.5 else "limited sunlight")


def wind_word(v: float, a: dict) -> str:
    return ("strong wind" if v >= a["wind_threshold"] + 1 else "promising wind" if v >= a["wind_threshold"]
            else "moderate wind" if v >= 5.0 else "weak wind")


def round1(split: dict) -> dict:
    out = {k: int(round(v)) for k, v in split.items()}
    out[max(out, key=out.get)] += 100 - sum(out.values())
    return out


def grid_balance(ctx: dict, a: dict, yearly_budget: float, gen_split: tuple[float, float]) -> float:
    """Share of the project budget for grid & storage that balances delivery and generation over 10 years, capped at
    what it takes to reach everyone unconnected."""
    sw, ww = gen_split
    solar_mwh_per_usd = ctx["solar"] * 365 * a["performance_ratio"] / a["solar_capex_per_mw"]
    wind_mwh_per_usd = 8760 * wind_cf(a, ctx["wind"]) / a["wind_capex_per_mw"]
    gen_people = (sw * solar_mwh_per_usd + ww * wind_mwh_per_usd) * 1000 / a["kwh_per_new_person"]
    line_people = (1 - a["storage_share"]) * a["households_per_km"] * a["household_size"] / a["line_cost_per_km"]
    balance = gen_people / (gen_people + line_people) if gen_people + line_people else 0.5
    unconnected = ctx["population"] * (100 - ctx["access0"]) / 100
    needed = unconnected / line_people / (yearly_budget * YEARS) if yearly_budget and line_people else 0.0
    return float(np.clip(min(balance, needed), 0.0, 0.8))


def recommend(iso3: str, a: dict, yearly_budget: float, peer: dict | None = None) -> dict:
    """Heuristic, documented in RULE: risk-adjusted portfolio. Expected energy per dollar from the best NASA solar and
    wind sites and the cost assumptions, divided by 1 + risk (cost overrun and variability), sets the solar vs wind split;
    wind below 5 m/s gets nothing. Grid & storage gets the share that balances new lines against new generation, and
    at least 25% (35% when solar + wind exceed 30%, so lines keep 25% and storage 10%). A 12% reserve covers overruns.
    Neither solar nor wind may exceed 40% on its own; anything above the cap goes to the other source, then to the grid.
    A peer can shift the mix: rural access rising faster than urban -> 10 points from generation to the grid;
    clean share rising by 5 points or more -> 5 points from the grid to generation (never below the grid floor)."""
    ctx = context(iso3, a)
    s_ret = ctx["solar"] * 365 * a["performance_ratio"] / a["solar_capex_per_mw"] if ctx["solar"] >= 4.0 else 0.0
    w_ret = 0.0 if ctx["wind"] < 5.0 else 8760 * wind_cf(a, ctx["wind"]) / a["wind_capex_per_mw"]
    sw, ww = s_ret / (1 + a["solar_risk"]), w_ret / (1 + a["wind_risk"])
    if sw + ww == 0:
        sw = 1.0  # neither resource is strong: solar is still the most widely deployable
    sw, ww = sw / (sw + ww), ww / (sw + ww)
    reserve = a["reserve_share"] * 100
    floor_low = a["lines_floor"] * 100
    floor_high = (a["lines_floor"] + a["storage_floor"]) * 100
    grid = max(floor_low, grid_balance(ctx, a, yearly_budget, (sw, ww)) * (100 - reserve))
    if 100 - reserve - grid > 30:
        grid = max(grid, floor_high)
    why = []
    if peer:
        if peer.get("rural_gain") is not None and peer.get("urban_gain") is not None and peer["rural_gain"] > peer["urban_gain"]:
            grid = min(100 - reserve, grid + 10)
            why.append("rural access rose fastest")
        if peer.get("clean_gain") is not None and peer["clean_gain"] >= 5:
            grid = max(floor_high if 100 - reserve - grid + 5 > 30 else floor_low, grid - 5)
            why.append("its clean share rose")
    gen = 100 - reserve - grid
    cap = a["single_source_cap"] * 100
    solar, wind = gen * sw, gen * ww
    if solar > cap:
        wind, solar = wind + (solar - cap) * (1 if ww > 0 else 0), cap
    if wind > cap:
        solar, wind = min(cap, solar + wind - cap), cap
    grid = 100 - reserve - solar - wind  # whatever the caps leave goes to the grid
    split = round1({"solar": solar, "wind": wind, "grid": grid, "reserve": reserve})
    out = {"split": split, "solar": ctx["solar"], "wind": ctx["wind"], "capped": {"solar": solar >= cap - 0.5, "wind": wind >= cap - 0.5}}
    out["banner"] = explain(iso3, a, split, out["capped"])
    out["method"] = METHOD
    if peer:
        lead = "grid & storage" if "rural access rose fastest" in why else "solar and wind" if why else "the same mix"
        out["line"] = (f"Based on {peer['country']} {peer['year']}: more {lead} because {' and '.join(why)}." if why
                       else f"Based on {peer['country']} {peer['year']}: no clear rural or clean-power shift, so the resource-based mix.")
    return out


def explain(iso3: str, a: dict, split: dict, capped: dict) -> list[str]:
    """Three short sentences, built only from the country's data and the split."""
    name = model.latest(iso3)["country"]
    prof = profile(iso3)
    r = prof["resources"]
    sun, wind = r["solar"], r["wind"]
    s_, w_, g_, res = split["solar"], split["wind"], split["grid"], split["reserve"]
    cap = a["single_source_cap"] * 100
    head = (f"Because {name} gets {sun_word(sun['value'], a)} ({sun['value']:.1f} kWh/m²/day at {sun['site']}) "
            f"and {wind_word(wind['value'], a)} ({wind['value']:.1f} m/s at {wind['site']}), ")
    note = lambda k: f", capped at {cap:.0f}% to limit single-source risk" if capped.get(k) else ""  # noqa: E731
    if w_ == 0:
        one = head + f"we put {s_}% into solar{note('solar')}, and nothing into wind, which is too weak below 5 m/s."
    elif s_ >= w_:
        one = head + f"we prioritize solar ({s_}%{note('solar')}) paired with wind ({w_}%)."
    else:
        one = head + f"we prioritize wind ({w_}%{note('wind')}) paired with solar ({s_}%)."
    lines, storage = grid_parts(a, normalize(split))
    acc, rur, urb = prof["access"]["value"], prof["rural"]["value"], prof["urban"]["value"]
    gap = 100 - (acc or 100)
    rural = (f", especially outside cities ({rur:.0f}% of rural people vs {urb:.0f}% in cities)"
             if rur is not None and urb is not None and urb - rur >= 15 else "")
    two = ((f"Because {gap:.0f}% of people lack power{rural}, " if gap >= 1 else "Because almost everyone already has power, ")
           + f"{g_}% goes to grid lines and battery storage ({lines * 100:.0f}% lines, {storage * 100:.0f}% storage) "
             f"to carry power to homes and keep it flowing at night and on calm days.")
    three = f"A {res}% reserve protects against cost overruns and lean budget years."
    return [one, two, three]


RULE = recommend.__doc__.split("Heuristic, documented in RULE: ")[1].replace("\n    ", " ").strip()


# ---------- Stress: budget uncertainty ----------

SHOCKS = {
    "budget_cut": {"label": "Budget cut 30%", "detail": "The yearly budget is 30% lower for all 10 years."},
    "capex": {"label": "Costs run over budget +25%", "detail": "Solar, wind, lines and batteries cost 25% more."},
    "delay": {"label": "Construction delay 2 years", "detail": "Every project finishes 2 years later than planned."},
}


def shock_inputs(name: str) -> dict:
    if name == "budget_cut":
        return {"factor": np.full((1, YEARS), 0.7), "capex_mult": 1.0, "extra_delay": 0}
    if name == "capex":
        return {"factor": np.ones((1, YEARS)), "capex_mult": 1.25, "extra_delay": 0}
    return {"factor": np.ones((1, YEARS)), "capex_mult": 1.0, "extra_delay": 2}


def bootstrap(values: list[float], n: int, block: int = 3, seed: int = 7) -> np.ndarray:
    """Paths of a series relative to today, replaying random 3-year stretches of its own yearly changes
    (demeaned, drifting 30% a year back to normal)."""
    v = np.asarray([x for x in values if x and x > 0], dtype=float)
    changes = np.diff(np.log(v)) if len(v) > 1 else np.array([])
    if len(changes) < block:
        return np.ones((n, YEARS))
    changes -= changes.mean()
    blocks = np.array([changes[i:i + block] for i in range(len(changes) - block + 1)])
    rng = np.random.default_rng(seed)
    draws = blocks[rng.integers(0, len(blocks), size=(n, -(-YEARS // block)))].reshape(n, -1)[:, :YEARS]
    level, out = np.zeros(n), np.empty((n, YEARS))
    for t in range(YEARS):
        level = 0.7 * level + draws[:, t]
        out[:, t] = level
    return np.exp(out)


def budget_futures(iso3: str, b: dict, n: int = 500) -> np.ndarray:
    """Budget multiplier in each future: the GDP part follows the country's own GDP swings, the resource part its
    resource-income swings, weighted by their share of the budget."""
    if not b["total"]:
        return np.ones((n, YEARS))
    rows = model.country_rows(iso3).dropna(subset=["gdp_usd"])
    gdp = bootstrap(rows.gdp_usd.tolist(), n)
    res = model.revenue_scenarios(iso3, n) if b["resource"]["amount"] else np.ones((n, YEARS))
    return (b["gdp"]["amount"] * gdp + b["resource"]["amount"] * res) / b["total"]
