"""Nahda backend. Run with: uvicorn main:app --reload --port 8000

Pre-feasibility and capital allocation tool for development finance institutions, NGOs and trade
organizations. Serves the data and models to the React workspace. Everything is computed from local files in data/
and ml/models/; nothing calls an external service at runtime."""

import json
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import differences
import model
import notes
import signature
from ml import impact
from ml import optimize as ml_optimize
from ml.twins import TwinIndex, load_panel

MODELS = Path(__file__).parent / "ml" / "models"
ML: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Load data and models once, so every request is fast."""
    start = time.time()
    panel = load_panel()
    ML["twins"] = TwinIndex.build(panel)
    ML["impact"] = joblib.load(MODELS / "impact.joblib")
    ML["explainer"] = shap.TreeExplainer(ML["impact"])
    ML["latest"] = pd.read_csv(MODELS / "latest_features.csv").set_index("iso3")
    ML["metrics"] = json.loads((MODELS / "metrics.json").read_text())
    ML["projections"] = json.loads((MODELS / "projections.json").read_text())
    signature.world()
    world()  # warm the cache
    # Preload Libya end to end (also warms SHAP and LightGBM, whose first call is slow)
    country("LBY")
    twins("LBY")
    simulate(SimulateRequest(iso3="LBY"))
    differences.typical_change()
    print(f"Models loaded in {time.time() - start:.1f}s · {len(ML['twins'].windows)} twin windows · Libya preloaded")
    yield


app = FastAPI(title="Nahda API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])


class Meta(BaseModel):
    """What the server did, for the System log."""
    detail: str
    server_ms: float


def check(iso3: str):
    if not model.known(iso3) or not model.has_sunlight(iso3):
        raise HTTPException(404, f"No data for {iso3}")


# ---------- World: every country, for the globe ----------

TARGET_RULE = ("Revitalization target: natural resource rents ≥ 10% of GDP (5-year average) AND at least one of "
               "electricity access < 95%, access fell over 20 years, or clean electricity < 10%; "
               "excluding high-income countries (GDP per person above $30,000).")


def target_reasons(iso3: str) -> list[str]:
    """Why a country is a revitalization target (empty list = not a target)."""
    rows = model.country_rows(iso3)
    lat = model.latest(iso3)
    rents = rows.resource_rents_pct_gdp.dropna().tail(5).mean()
    gdp = lat["gdp_per_capita_usd"]
    if pd.isna(rents) or rents < 10 or gdp is None or gdp > 30_000:
        return []
    reasons = []
    access = lat["electricity_access_pct"]
    if access is not None and access < 95:
        reasons.append(f"access {access:.0f}%")
    acc = rows[["year", "electricity_access_pct"]].dropna()
    if len(acc):
        y1 = acc.year.iloc[-1]
        earlier = acc[acc.year <= y1 - 20]
        if len(earlier) and acc.electricity_access_pct.iloc[-1] < earlier.electricity_access_pct.iloc[-1]:
            reasons.append("access fell over 20 years")
    clean = lat["renewable_electricity_pct"]
    if clean is not None and clean < 10:
        reasons.append(f"clean electricity {clean:.2f}%" if clean < 1 else f"clean electricity {clean:.1f}%")
    return [f"resource rents {rents:.0f}% of GDP", *reasons] if reasons else []


def iso2_codes() -> dict[str, str]:
    """ISO3 -> ISO2 for flags, from the Natural Earth outlines (Norway has no code there, so it is added by hand)."""
    feats = json.loads((Path(__file__).parent / "data" / "countries.geojson").read_text(encoding="utf-8"))["features"]
    out = {"NOR": "NO"}
    for f in feats:
        p = f["properties"]
        iso3 = p.get("ISO_A3") if p.get("ISO_A3") not in (None, "-99") else p.get("ADM0_A3")
        iso2 = next((p[k] for k in ["ISO_A2", "WB_A2"] if p.get(k) not in (None, "-99")), None)
        if iso3 and iso2:
            out.setdefault(iso3, iso2)
    return out


class WorldCountry(BaseModel):
    iso3: str
    iso2: str | None
    name: str
    hover: str
    resource: str
    target: list[str]
    access: dict[int, float]  # year -> % with electricity (measured)
    projected: dict[int, float]  # year -> % (model projection, no plan)


class World(BaseModel):
    years: list[int]
    countries: list[WorldCountry]
    target_rule: str
    meta: Meta


_world_cache: dict = {}


@app.get("/api/world", response_model=World)
def world():
    start = time.time()
    if "data" in _world_cache:
        cached = _world_cache["data"]
        return cached.model_copy(update={"meta": Meta(detail=f"{len(cached.countries)} countries · built at startup, served from memory",
                                                      server_ms=(time.time() - start) * 1000)})
    panel, _, _ = model.load()
    iso2 = iso2_codes()
    out = []
    for iso3, g in panel.groupby("iso3"):
        if not model.has_sunlight(iso3):
            continue  # tiny territories without an outline on the globe
        sig = signature.signature(iso3, 1)
        acc = g.dropna(subset=["electricity_access_pct"])
        proj = ML["projections"].get(iso3)
        projected = {}
        if proj:
            for i in range(1, 11):
                projected[proj["from_year"] + i] = proj["from"] + (proj["to"] - proj["from"]) * i / 10
        out.append(WorldCountry(
            iso3=iso3, iso2=iso2.get(iso3), name=str(g.country.iloc[0]), hover=sig[0]["text"] if sig else "",
            resource=model.resource_word(iso3), target=target_reasons(iso3),
            access={int(y): float(v) for y, v in zip(acc.year, acc.electricity_access_pct)}, projected=projected,
        ))
    years = sorted({y for c in out for y in [*c.access, *c.projected]})
    _world_cache["data"] = World(years=years, countries=out, target_rule=TARGET_RULE, meta=Meta(
        detail=f"{len(out)} countries · signatures ranked across {len(signature.LEVELS) + 1} indicators",
        server_ms=(time.time() - start) * 1000))
    return _world_cache["data"]


# ---------- Country profile ----------

class Fact(BaseModel):
    text: str
    kind: str
    unit: str
    value: float
    year: int
    percentile: float
    sparkline: list[dict]


class Factor(BaseModel):
    label: str
    value: float | None
    effect: float


def classify(iso3: str) -> dict:
    """Readable, rule-based label from the data, e.g. 'High oil dependency · Electricity gap · LBY'."""
    word = model.resource_word(iso3)
    col = model.RESOURCES[model.main_resource(iso3)][0]
    rents = model.country_rows(iso3)[col].dropna().tail(5).mean()
    rents = 0.0 if pd.isna(rents) else float(rents)
    access = model.latest(iso3)["electricity_access_pct"]
    if rents >= 20:
        dep = f"High {word} dependency"
    elif rents >= 10:
        dep = f"Significant {word} income"
    elif rents >= 5:
        dep = f"Some {word} income"
    else:
        dep = "Diversified economy"
    if access is None:
        acc = "Access unknown"
    elif access < 95:
        acc = "Electricity gap"
    elif access < 99.5:
        acc = "Near-universal access"
    else:
        acc = "Universal access"
    rules = (f"{word.capitalize()} rents (5-year average): {rents:.1f}% of GDP. "
             "High dependency ≥ 20% · significant ≥ 10% · some ≥ 5% · otherwise diversified. "
             f"Electricity access: {access:.1f}%. Gap < 95% · near-universal < 99.5% · otherwise universal."
             if access is not None else f"{word.capitalize()} rents: {rents:.1f}% of GDP.")
    return {"label": f"{dep} · {acc} · {iso3}", "rules": rules, "rents_pct_gdp": rents}


class Country(BaseModel):
    iso3: str
    name: str
    resource: str
    classification: dict
    facts: list[Fact]
    stats: dict
    revenue: dict
    sun: dict
    outlook: dict | None
    model_card: dict
    meta: Meta


@app.get("/api/country/{iso3}", response_model=Country)
def country(iso3: str):
    check(iso3)
    start = time.time()
    lat = model.latest(iso3)
    rb = model.revenue_baseline(iso3) if model.revenue_history(iso3) else None
    best = model.sites_for(iso3)
    sun = {"site": str(best.iloc[0].site), "value": float(best.iloc[0].solar_kwh_m2_day),
           "oslo": float(model.sites_for("NOR").iloc[0].solar_kwh_m2_day)} if len(best) else {}

    outlook = None
    if iso3 in ML["latest"].index:
        row = ML["latest"].loc[[iso3]]
        outlook = {"year": int(row.year.iloc[0]), **impact.explain(ML["impact"], ML["explainer"], row)}
    facts = signature.signature(iso3)
    return Country(
        iso3=iso3, name=lat["country"], resource=model.resource_word(iso3), classification=classify(iso3),
        facts=[Fact(**{k: f[k] for k in Fact.model_fields}) for f in facts],
        stats={k: lat.get(k) for k in ["population", "electricity_access_pct", "electricity_access_pct_year",
                                       "renewable_electricity_pct", "renewable_electricity_pct_year", "gdp_per_capita_usd"]},
        revenue={} if rb is None else {
            "avg": rb["avg"], "years": rb["years"], "history": rb["history"],
            "low": rb["worst"], "high": rb["best"], "per_person": rb["avg"] / lat["population"],
            # The range covers the last 10 years that have data, which may end well before today
            "range_years": [rb["history"][-min(10, len(rb["history"]))]["year"], rb["history"][-1]["year"]],
        },
        sun=sun, outlook=outlook, model_card=ML["metrics"],
        meta=Meta(detail=f"{len(facts)} signature facts · LightGBM + SHAP on {len(impact.FEATURES)} features",
                  server_ms=(time.time() - start) * 1000),
    )


# ---------- Twins ----------

class Twins(BaseModel):
    year: int
    access_now: float
    gdp_now: float
    population_now: float
    twins: list[dict]
    forecast: list[dict]
    windows_searched: int
    meta: Meta


@app.get("/api/twins/{iso3}", response_model=Twins)
def twins(iso3: str):
    check(iso3)
    start = time.time()
    t = ML["twins"].find(iso3)
    if t is None:
        raise HTTPException(404, f"Not enough history to find twins for {iso3}")
    ms = (time.time() - start) * 1000
    return Twins(**{k: t[k] for k in ["year", "access_now", "gdp_now", "population_now", "twins", "forecast", "windows_searched"]},
                 meta=Meta(detail=f"DTW over {t['windows_searched']:,} country-year windows · {len(t['twins'])} matches", server_ms=ms))


class TwinCompare(BaseModel):
    twin: str
    twin_name: str
    twin_years: list[int]
    own_years: list[int]
    rows: list[dict]
    differences: list[str]
    meta: Meta


@app.get("/api/twins/{iso3}/compare/{twin}", response_model=TwinCompare)
def twin_compare(iso3: str, twin: str):
    """What the twin did in the 10 years after the match vs this country's last 10 years."""
    check(iso3)
    start = time.time()
    t = ML["twins"].find(iso3)
    match = next((x for x in (t or {}).get("twins", []) if x["iso3"] == twin), None)
    if match is None:
        raise HTTPException(404, f"{twin} is not a twin of {iso3}")
    out = differences.compare(iso3, model.latest(iso3)["country"], t["year"], twin, match["country"], match["year"])
    have = sum(r["score"] is not None for r in out["rows"])
    return TwinCompare(**out, meta=Meta(detail=f"{have} of {len(out['rows'])} indicators with data for both · World Bank",
                                         server_ms=(time.time() - start) * 1000))


# ---------- Simulate and optimize ----------

class Reform(BaseModel):
    """Gradual fuel price reform, an optional extra funding source."""
    target_price: float = Field(0.60, ge=0.01, le=3.0, description="target pump price, $/L")
    phase_years: int = Field(5, ge=1, le=10)
    rebate_share: float = Field(0.5, ge=0, le=1, description="share of freed subsidy returned to households")
    add_to_plan: bool = True


class SimulateRequest(BaseModel):
    iso3: str
    share: float = Field(0.10, ge=0, le=0.3, description="share of resource income invested each year")
    split: dict[str, float] = {"solar": 35, "rail": 20, "industry": 15, "fund": 30}
    assumptions: dict[str, float] = {}
    supply: str = Field("import", pattern="^(import|local)$")
    reform: Reform | None = None
    preset: str = "power"


class Simulation(BaseModel):
    share: float
    base_revenue: float
    pool: float
    per_person: float
    split_amounts: dict[str, float]
    start: dict
    years: list[dict]
    months_covered: float
    access_full_year: int | None
    sites: list[dict]
    homes: dict
    rail: dict
    low_resource: dict
    household_size: float
    country_defaults: dict
    sectors: dict
    supply: dict
    reform: dict | None
    shocks: dict
    futures: dict
    meta: Meta


def homes_summary(ctx: dict, y: dict) -> dict:
    """Homes powered never exceeds the homes that exist; beyond that, the surplus goes to business and industry.
    Uses the same generation figure and the same national-demand denominator as the clean electricity share."""
    coverage = y["household_coverage"]
    every = coverage >= 1
    return {
        "households": ctx["households"], "home_kwh": ctx["home_kwh"], "coverage": coverage,
        "homes_powered": min(y["homes"], ctx["households"]),
        "every_home": bool(every), "left_over_share": float(1 - 1 / coverage) if every else 0.0,
    }


def rail_summary(ctx: dict, a: dict, y: dict, rail_pool: float, path: list[dict] | None = None) -> dict:
    """Rail result: km funded by year 10, the corridor it goes toward, and years to finish at this budget."""
    r = ctx["route"]
    km_per_year = rail_pool / a["rail_cost_per_km"] if rail_pool else 0.0
    target = r["km"]
    years = target / km_per_year + a["rail_build_years"] if km_per_year else None
    done = next((p["year"] for p in path or [] if p["rail_km"] >= target - 1e-6), None)
    return {"from": r["from"], "to": r["to"], "route_km": target, "coords": r["coords"],
            "funded_km": min(y["rail_km"], target), "km_per_year": km_per_year, "annual_pool": rail_pool,
            "years_to_complete": years, "complete_year": done}


def year10(result: dict, i: int = 0) -> dict:
    last = model.rows(result, i)[-1]
    last["shortfall_total"] = float(result["shortfall"][i].sum())
    last["fully_funded"] = bool(result["fully_funded"][i])
    return last


@app.post("/api/simulate", response_model=Simulation)
def simulate(req: SimulateRequest):
    check(req.iso3)
    start = time.time()
    a = model.params(req.assumptions, req.iso3)
    ctx = model.context(req.iso3, a)
    split = model.normalize(req.split)
    kwh = float(model.sites_for(req.iso3).iloc[0].solar_kwh_m2_day)
    rf = req.reform
    # Subsidy savings kept by the state (after household rebates) can be added to the plan's pool
    extra = ((1 - rf.rebate_share) * model.reform_savings(ctx, a, rf.target_price, rf.phase_years)
             if rf and rf.add_to_plan else np.zeros(model.YEARS))
    run = lambda rev, fuel=None, capex=1.0: model.simulate(ctx, a, req.share, split, kwh, rev, fuel, capex,  # noqa: E731
                                                          supply=req.supply, extra=extra)

    base = run(np.ones((1, model.YEARS)))
    rows = model.rows(base)
    y = rows[-1]
    pool = req.share * ctx["base_revenue"]
    word = model.resource_word(req.iso3)
    rail = rail_summary(ctx, a, y, (pool + float(extra.mean())) * split[1], rows)
    reform = None
    if rf:
        done = np.array([float(r["rail_km"] >= ctx["route"]["km"] - 1e-6) for r in rows])
        reform = {**model.fuel_reform(req.iso3, ctx, a, rf.target_price, rf.phase_years, rf.rebate_share, done),
                  **rf.model_dump(), "price_now": a["fuel_price_now"], "added_to_plan": extra.tolist(),
                  "litres_per_person": a["fuel_litres_per_person"],
                  "litres_source": None if "fuel_litres_per_person" in req.assumptions
                  else model.default_fuel_litres(req.iso3, a["road_fuel_share"])}
    sup = model.supply_terms(a, req.supply)

    before = year10(base)
    shocks = {}
    for name, spec in model.SHOCKS.items():
        si = model.shock_inputs(name)
        shocked = run(si["rev_factor"], si["fuel_mult"], si["capex_mult"])
        after = year10(shocked)
        label = spec["label"].replace("Oil", word.capitalize()) if name == "oil_price" else spec["label"]
        path = [{"year": r["year"], "access_pct": r["access_pct"], "renewable_pct": r["renewable_pct"]} for r in model.rows(shocked)]
        shocks[name] = {**spec, "label": label, "before": before, "after": after, "path": path,
                        "note": notes.shock(name, before, after, req.iso3)}

    futures = model.revenue_scenarios(req.iso3, 500)
    mc = run(futures)
    clean10, access10 = mc["renewable_pct"][:, -1], mc["access_pct"][:, -1]
    history = model.revenue_history_years(req.iso3)
    ms = (time.time() - start) * 1000
    return Simulation(
        share=req.share, base_revenue=ctx["base_revenue"], pool=pool, per_person=pool / ctx["population"],
        split_amounts=dict(zip(model.SECTORS, (pool * split).tolist())),
        start={"access": ctx["access0"], "clean": ctx["renew0"],
               "access_year": model.latest(req.iso3)["electricity_access_pct_year"],
               "clean_year": model.latest(req.iso3)["renewable_electricity_pct_year"]},
        years=rows,
        months_covered=y["fund"] / (ctx["base_revenue"] / 12) if ctx["base_revenue"] else 0,
        access_full_year=next((r["year"] for r in rows if r["access_pct"] >= 99.95), None),
        sites=model.allocate_sites(req.iso3, y["solar_mw"]), shocks=shocks,
        homes=homes_summary(ctx, y), rail=rail,
        low_resource={"is_low": classify(req.iso3)["rents_pct_gdp"] < 5, "rents_pct_gdp": classify(req.iso3)["rents_pct_gdp"]},
        household_size=a["household_size"],
        country_defaults={k: a[k] for k in ["household_size", "fuel_litres_per_person"]},
        sectors=model.sector_economics(a, base, kwh, req.supply),
        supply={"choice": req.supply, "label": model.SUPPLY[req.supply], "capex_mult": sup["capex_mult"],
                "build_years": sup["build_years"], "jobs": y["local_jobs"], "local_value": y["local_value"],
                "note": "PV modules are sourced via certified international OEMs on both routes."},
        reform=reform,
        futures={
            "runs": len(futures), "history_years": history, "resource": word,
            "access_paths": np.round(mc["access_pct"], 2).tolist(), "clean_paths": np.round(mc["renewable_pct"], 2).tolist(),
            "access_p10": float(np.percentile(access10, 10)), "access_p50": float(np.percentile(access10, 50)),
            "access_p90": float(np.percentile(access10, 90)), "clean_p10": float(np.percentile(clean10, 10)),
            "p_funded": float(mc["fully_funded"].mean()),
        },
        meta=Meta(detail=f"500 bootstrap futures from {history} {word} income · 4 scenarios", server_ms=ms),
    )


class Optimized(BaseModel):
    split: dict[str, int]
    p_funded: float
    access_y10: float
    feasible: bool
    plans_tested: int
    min_funded: float
    preset: str
    preset_label: str
    rationale: str
    meta: Meta


def rationale(req: SimulateRequest, best: dict, ctx: dict, a: dict, kwh: float, futures: np.ndarray) -> str:
    """One sentence on why the preset chose this split, built from the model's own results."""
    s = best["split"]
    r = model.simulate(ctx, a, req.share, model.normalize(s), kwh, futures, supply=req.supply)
    med = lambda k: float(np.median(r[k][:, -1]))  # noqa: E731
    word = model.resource_word(req.iso3)
    route = ctx["route"]
    econ = model.sector_economics(a, r, kwh, req.supply)
    months = med("fund") / (ctx["base_revenue"] / 12) if ctx["base_revenue"] else 0
    p = best["p_funded"]
    lead = "" if best["feasible"] else "No split keeps spending on track in 80% of futures at this level, so this is the most robust one. "
    if req.preset == "power":
        body = (f"Puts {s['solar']}% into solar, the fastest way to connect people here: {med('access_pct'):.0f}% have electricity by year 10 "
                f"in the median future." if ctx["access0"] < 99 else
                f"Puts {s['solar']}% into solar: access is already {ctx['access0']:.1f}%, so the gain is cleaner power, "
                f"{med('renewable_pct'):.1f}% clean by year 10 in the median future.")
    elif req.preset == "mobility":
        km = min(med("rail_km"), route["km"])
        body = (f"Puts {s['rail']}% into transport: {km:,.0f} of {route['km']:,.0f} km of rail open by year 10"
                + (", the full corridor; more rail money would sit idle, so the rest goes elsewhere." if km >= route["km"] - 1 else "."))
    elif req.preset == "growth":
        body = (f"Puts {s['industry']}% into tourism and non-oil industry, the highest non-oil return per dollar under current assumptions "
                f"({100 / econ['industry']['payback']:.0f}%/yr vs {100 / econ['rail']['payback']:.0f}%/yr for rail): about "
                f"{notes.money(med('industry_value') + med('rail_value'))} a year of new activity by year 10. Solar's return is "
                f"{word} sold abroad instead of burned, so it counts toward Power, not Growth.")
    elif req.preset == "resilience":
        body = (f"Saves {s['fund']}%: the fund holds about {months:.0f} months of {word} income by year 10, and at least 90% "
                f"of planned spending happens in {p:.0%} of futures.")
    else:
        body = (f"Gives every sector at least 10% and weighs access, rail, non-oil returns and savings equally: "
                f"{med('access_pct'):.0f}% access, {min(med('rail_km'), route['km']):,.0f} km of rail, "
                f"{notes.money(med('industry_value') + med('rail_value'))} a year of non-oil activity and {months:.0f} months saved by year 10.")
    return lead + body


@app.post("/api/optimize", response_model=Optimized)
def optimize(req: SimulateRequest):
    """Best power / transport / industry / savings split at the chosen investment level for a priority preset,
    while at least 90% of planned spending happens in ≥80% of futures."""
    check(req.iso3)
    if req.preset not in ml_optimize.PRESETS:
        raise HTTPException(422, f"Unknown preset {req.preset}")
    start = time.time()
    a = model.params(req.assumptions, req.iso3)
    ctx = model.context(req.iso3, a)
    kwh = float(model.sites_for(req.iso3).iloc[0].solar_kwh_m2_day)
    futures = model.revenue_scenarios(req.iso3, 500)
    best = ml_optimize.best_plan(ctx, a, req.share, kwh, futures, req.preset, req.supply)
    ms = (time.time() - start) * 1000
    return Optimized(**best, rationale=rationale(req, best, ctx, a, kwh, futures), meta=Meta(
        detail=f"{best['preset_label']} · grid search · {best['plans_tested']} splits × 500 futures · "
               f"funded in {best['p_funded']:.0%}", server_ms=ms))


@app.get("/api/assumptions")
def assumptions():
    return model.ASSUMPTIONS


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}
