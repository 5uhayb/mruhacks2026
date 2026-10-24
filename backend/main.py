"""Nahda backend. Run with: uvicorn main:app --reload --port 8000

Serves the data and models to the React workspace. Everything is computed from local files in data/
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

class WorldCountry(BaseModel):
    iso3: str
    name: str
    hover: str
    resource: str
    access: dict[int, float]  # year -> % with electricity (measured)
    projected: dict[int, float]  # year -> % (model projection, no plan)


class World(BaseModel):
    years: list[int]
    countries: list[WorldCountry]
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
            iso3=iso3, name=str(g.country.iloc[0]), hover=sig[0]["text"] if sig else "",
            resource=model.resource_word(iso3),
            access={int(y): float(v) for y, v in zip(acc.year, acc.electricity_access_pct)}, projected=projected,
        ))
    years = sorted({y for c in out for y in [*c.access, *c.projected]})
    _world_cache["data"] = World(years=years, countries=out, meta=Meta(
        detail=f"{len(out)} countries · signatures ranked across {len(signature.LEVELS) + 1} indicators",
        server_ms=(time.time() - start) * 1000))
    return _world_cache["data"]


# ---------- Country profile ----------

class Fact(BaseModel):
    text: str
    kind: str
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


# ---------- Simulate and optimize ----------

class SimulateRequest(BaseModel):
    iso3: str
    share: float = Field(0.10, ge=0, le=0.3, description="share of resource income invested each year")
    split: dict[str, float] = {"solar": 40, "rail": 30, "fund": 30}
    assumptions: dict[str, float] = {}


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
    shocks: dict
    futures: dict
    meta: Meta


def year10(result: dict, i: int = 0) -> dict:
    last = model.rows(result, i)[-1]
    last["shortfall_total"] = float(result["shortfall"][i].sum())
    last["fully_funded"] = bool(result["fully_funded"][i])
    return last


@app.post("/api/simulate", response_model=Simulation)
def simulate(req: SimulateRequest):
    check(req.iso3)
    start = time.time()
    a = model.params(req.assumptions)
    ctx = model.context(req.iso3, a)
    split = model.normalize(req.split)
    kwh = float(model.sites_for(req.iso3).iloc[0].solar_kwh_m2_day)

    base = model.simulate(ctx, a, req.share, split, kwh, np.ones((1, model.YEARS)))
    rows = model.rows(base)
    y = rows[-1]
    pool = req.share * ctx["base_revenue"]
    word = model.resource_word(req.iso3)

    before = year10(base)
    shocks = {}
    for name, spec in model.SHOCKS.items():
        si = model.shock_inputs(name)
        after = year10(model.simulate(ctx, a, req.share, split, kwh, si["rev_factor"], si["fuel_mult"], si["capex_mult"]))
        label = spec["label"].replace("Oil", word.capitalize()) if name == "oil_price" else spec["label"]
        shocks[name] = {**spec, "label": label, "before": before, "after": after, "note": notes.shock(name, before, after, req.iso3)}

    futures = model.revenue_scenarios(req.iso3, 500)
    mc = model.simulate(ctx, a, req.share, split, kwh, futures)
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
    meta: Meta


@app.post("/api/optimize", response_model=Optimized)
def optimize(req: SimulateRequest):
    """Best solar / rail / savings split at the chosen investment level: fastest electricity access,
    while at least 90% of planned spending happens in ≥80% of futures."""
    check(req.iso3)
    start = time.time()
    a = model.params(req.assumptions)
    ctx = model.context(req.iso3, a)
    kwh = float(model.sites_for(req.iso3).iloc[0].solar_kwh_m2_day)
    best = ml_optimize.best_plan(ctx, a, req.share, kwh, model.revenue_scenarios(req.iso3, 500))
    ms = (time.time() - start) * 1000
    return Optimized(**best, meta=Meta(
        detail=f"grid search · {best['plans_tested']} splits × 500 futures · best: {best['access_y10']:.0f}% access, "
               f"funded in {best['p_funded']:.0%}", server_ms=ms))


@app.get("/api/assumptions")
def assumptions():
    return model.ASSUMPTIONS


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}
