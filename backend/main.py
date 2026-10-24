"""Nahda backend: electrification planner. Run with: uvicorn main:app --reload --port 8000

Helps countries below 90% electricity access close the gap: peers that succeeded, and a solar / wind / grid & storage
mix from real resource data. Everything is computed from local files in data/ and ml/models/; only the optional
Ask Nahda advisor calls an external AI service."""

import json
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
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

import advisor
import differences
import electric
import model
import signature
from ml import impact
from ml.twins import ELECTRIC_FEATURES, PEER_RULE, TwinIndex, load_panel

MODELS = Path(__file__).parent / "ml" / "models"
ML: dict = {}
TARGET_ACCESS = 90  # the planner focuses on countries below 90% access


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Load data and models once, so every request is fast."""
    start = time.time()
    ML["peers"] = TwinIndex.build(load_panel(), ELECTRIC_FEATURES)
    ML["impact"] = joblib.load(MODELS / "impact.joblib")
    ML["explainer"] = shap.TreeExplainer(ML["impact"])
    ML["latest"] = pd.read_csv(MODELS / "latest_features.csv").set_index("iso3")
    ML["metrics"] = json.loads((MODELS / "metrics.json").read_text())
    ML["projections"] = json.loads((MODELS / "projections.json").read_text())
    signature.world()
    w = world()
    first = w.quick_picks[0]["iso3"] if w.quick_picks else "NGA"
    country(first)  # also warms SHAP and LightGBM, whose first call is slow
    peers(first)
    simulate(SimulateRequest(iso3=first))
    print(f"Models loaded in {time.time() - start:.1f}s · {len(ML['peers'].windows)} peer windows · {first} preloaded")
    yield


app = FastAPI(title="Nahda API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://localhost:4173"],
                   allow_methods=["*"], allow_headers=["*"])


class Meta(BaseModel):
    """What the server did, for the System log."""
    detail: str
    server_ms: float


def check(iso3: str):
    if not model.known(iso3) or electric.resources(iso3)["solar"] is None:
        raise HTTPException(404, f"No data for {iso3}")


def tier(access: float | None) -> str:
    if access is None:
        return "No data"
    return "Critical" if access < 60 else "Struggling" if access < TARGET_ACCESS else "Connected"


# ---------- World: every country, for the globe ----------

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


QUICK_PICK_COLUMNS = ["electricity_access_pct", "renewable_electricity_pct", "gdp_usd", "population", "kwh_per_person"]
QUICK_PICK_RULE = ("Quick picks: the 5 countries below 90% electricity access with the most World Bank values since 2000 "
                   "(access, urban and rural access, clean share, GDP, population, electricity use) plus NASA sites.")


def coverage(iso3: str, raw: pd.DataFrame, detail: pd.DataFrame) -> int:
    r = raw[(raw.iso3 == iso3) & (raw.year >= 2000)]
    d = detail[(detail.iso3 == iso3) & (detail.year >= 2000)]
    return int(r[QUICK_PICK_COLUMNS].notna().sum().sum() + d[["urban_access_pct", "rural_access_pct"]].notna().sum().sum()
               + len(electric.sites()[electric.sites().iso3 == iso3]))


class WorldCountry(BaseModel):
    iso3: str
    iso2: str | None
    name: str
    hover: str
    access: dict[int, float]  # year -> % with electricity (measured)
    projected: dict[int, float]  # year -> % (model projection, no plan)


class World(BaseModel):
    years: list[int]
    countries: list[WorldCountry]
    quick_picks: list[dict]
    quick_pick_rule: str
    meta: Meta


_world_cache: dict = {}


@app.get("/api/world", response_model=World)
def world():
    start = time.time()
    if "data" in _world_cache:
        cached = _world_cache["data"]
        return cached.model_copy(update={"meta": Meta(detail=f"{len(cached.countries)} countries · served from memory",
                                                      server_ms=(time.time() - start) * 1000)})
    panel, _, _ = model.load()
    detail = electric.access_detail()
    iso2 = iso2_codes()
    out, picks = [], []
    for iso3, g in panel.groupby("iso3"):
        if electric.resources(iso3)["solar"] is None:
            continue  # tiny territories without an outline on the globe
        acc = g.dropna(subset=["electricity_access_pct"])
        proj = ML["projections"].get(iso3)
        projected = {proj["from_year"] + i: proj["from"] + (proj["to"] - proj["from"]) * i / 10 for i in range(1, 11)} if proj else {}
        last = acc.iloc[-1] if len(acc) else None
        rural = electric.latest_value(detail, iso3, "rural_access_pct")
        hover = (f"Electricity access {last.electricity_access_pct:.1f}% ({int(last.year)})"
                 + (f" · rural {rural['value']:.0f}% ({rural['year']})" if rural["value"] is not None else "")) if last is not None else "No access data"
        out.append(WorldCountry(iso3=iso3, iso2=iso2.get(iso3), name=str(g.country.iloc[0]), hover=hover,
                                access={int(y): float(v) for y, v in zip(acc.year, acc.electricity_access_pct)}, projected=projected))
        if last is not None and last.electricity_access_pct < TARGET_ACCESS and iso2.get(iso3):
            picks.append({"iso3": iso3, "iso2": iso2[iso3], "name": str(g.country.iloc[0]), "access": float(last.electricity_access_pct),
                          "year": int(last.year), "coverage": coverage(iso3, panel, detail)})
    picks = sorted(picks, key=lambda p: -p["coverage"])[:5]
    years = sorted({y for c in out for y in [*c.access, *c.projected]})
    _world_cache["data"] = World(years=years, countries=out, quick_picks=picks, quick_pick_rule=QUICK_PICK_RULE, meta=Meta(
        detail=f"{len(out)} countries · quick picks by data coverage", server_ms=(time.time() - start) * 1000))
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


class Country(BaseModel):
    iso3: str
    name: str
    tier: str
    facts: list[Fact]
    profile: dict
    badges: list[dict]
    budget: dict
    outlook: dict | None
    model_card: dict
    meta: Meta


def badges(prof: dict, a: dict) -> list[dict]:
    r = prof["resources"]
    out = []
    if r["solar"] and r["solar"]["value"] >= a["solar_threshold"]:
        out.append({"label": "High solar potential", "rule": f"Best site's sunlight ≥ {a['solar_threshold']:g} kWh/m²/day (editable)."})
    if r["wind"] and r["wind"]["value"] >= a["wind_threshold"]:
        out.append({"label": "Promising wind", "rule": f"Best site's 50 m wind speed ≥ {a['wind_threshold']:g} m/s (editable). "
                                                         "Point estimate; turbine sites need detailed local studies."})
    return out


@app.get("/api/country/{iso3}", response_model=Country)
def country(iso3: str):
    check(iso3)
    start = time.time()
    a = electric.params(iso3=iso3)
    prof = electric.profile(iso3)
    outlook = None
    if iso3 in ML["latest"].index:
        row = ML["latest"].loc[[iso3]]
        outlook = {"year": int(row.year.iloc[0]), **impact.explain(ML["impact"], ML["explainer"], row)}
    facts = signature.signature(iso3, only=signature.ELECTRICITY)
    return Country(
        iso3=iso3, name=model.latest(iso3)["country"], tier=tier(prof["access"]["value"]),
        facts=[Fact(**{k: f[k] for k in Fact.model_fields}) for f in facts],
        profile=prof, badges=badges(prof, a), budget=electric.budget(iso3, a), outlook=outlook, model_card=ML["metrics"],
        meta=Meta(detail=f"{len(prof['resources']['sites'])} NASA sites · LightGBM + SHAP", server_ms=(time.time() - start) * 1000),
    )


# ---------- Peers ----------

def peer_details(p: dict) -> dict:
    """What changed for a peer over its 10 years, from the data only."""
    y0, y1 = p["year"], p["year"] + 10
    ch = {k: differences.change(p["iso3"], k, y0, y1) for k in
          ["urban_access_pct", "rural_access_pct", "renewable_electricity_pct", "fixed_investment_pct_gdp"]}
    gain = lambda c: None if c["from"] is None else c["to"] - c["from"]  # noqa: E731
    urban, rural, clean, inv = (gain(ch[k]) for k in ch)
    f = lambda v: f"{v:.0f}%" if v >= 10 else f"{v:.1f}%"  # noqa: E731
    parts = []
    if rural is not None and urban is not None:
        parts.append(f"Rural access {f(ch['rural_access_pct']['from'])}→{f(ch['rural_access_pct']['to'])}, "
                     f"urban {f(ch['urban_access_pct']['from'])}→{f(ch['urban_access_pct']['to'])}")
    extras = [(abs(clean or 0), f"clean share {f(ch['renewable_electricity_pct']['from'])}→{f(ch['renewable_electricity_pct']['to'])}") if clean is not None else None,
              (abs(inv or 0), f"investment {f(ch['fixed_investment_pct_gdp']['from'])}→{f(ch['fixed_investment_pct_gdp']['to'])} of GDP") if inv is not None else None]
    extras = sorted([e for e in extras if e and e[0] >= 2], key=lambda e: -e[0])
    if extras:
        parts.append(extras[0][1])
    changed = ("; ".join(parts) + ".") if parts else "No urban, rural, clean-share or investment data for these years."
    changed = changed[0].upper() + changed[1:]
    a0, a1 = p["access"][0], p["access"][-1]
    c = ch["renewable_electricity_pct"]
    result = (f"Access {a0:.0f}% → {a1:.0f}% ({a1 - a0:+.0f} pts)"
              + (f" · clean share {c['from']:.0f}% → {c['to']:.0f}%" if c["from"] is not None else ""))
    return {**p, "urban_gain": urban, "rural_gain": rural, "clean_gain": clean, "changed": changed, "result": result,
            "access_change": a1 - a0}


class Peers(BaseModel):
    year: int
    access_now: float
    peers: list[dict]
    rule: str
    playbook: dict | None
    playbook_rule: str
    windows_searched: int
    meta: Meta


@app.get("/api/peers/{iso3}", response_model=Peers)
def peers(iso3: str):
    check(iso3)
    start = time.time()
    found = ML["peers"].find_peers(iso3)
    if found is None:
        raise HTTPException(404, f"Not enough history to find peers for {iso3}")
    ps = [peer_details(p) for p in found["peers"]]
    playbook = None
    if ps:
        a = electric.params(iso3=iso3)
        rec = electric.recommend(iso3, a, electric.budget(iso3, a)["total"], ps[0])
        playbook = {"peer": ps[0]["iso3"], "peer_name": ps[0]["country"], "peer_year": ps[0]["year"], "split": rec["split"], "line": rec["line"]}
    return Peers(year=found["year"], access_now=found["access_now"], peers=ps, rule=PEER_RULE, playbook=playbook,
                 playbook_rule=electric.RULE, windows_searched=found["windows_searched"],
                 meta=Meta(detail=f"DTW over {found['windows_searched']:,} qualifying windows · {len(ps)} peers",
                           server_ms=(time.time() - start) * 1000))


# ---------- Simulate ----------

class SimulateRequest(BaseModel):
    iso3: str
    split: dict[str, float] | None = None  # None = the recommended mix
    assumptions: dict[str, float] = {}


class Simulation(BaseModel):
    budget: dict
    split: dict[str, float]
    split_amounts: dict[str, float]
    recommendation: dict
    start: dict
    years: list[dict]
    cards: dict
    limit: str
    sites: dict
    household_size: float
    shocks: dict
    futures: dict
    meta: Meta


def y10(r: dict, i: int = 0) -> dict:
    return {k: float(r[k][i, -1]) for k in ["access_pct", "clean_pct", "solar_mw", "wind_mw", "line_km", "storage_mwh"]}


@app.post("/api/simulate", response_model=Simulation)
def simulate(req: SimulateRequest):
    check(req.iso3)
    start = time.time()
    a = electric.params(req.assumptions, req.iso3)
    ctx = electric.context(req.iso3, a)
    b = electric.budget(req.iso3, a)
    rec = electric.recommend(req.iso3, a, b["total"])
    split = electric.normalize(req.split or rec["split"])
    base = electric.simulate(ctx, a, b["total"], split, np.ones((1, electric.YEARS)))
    rows = [{"year": t + 1, **{k: float(base[k][0, t]) for k in ["access_pct", "clean_pct", "solar_mw", "wind_mw", "line_km", "storage_mwh"]}}
            for t in range(electric.YEARS)]
    last = y10(base)
    pay = electric.paybacks(a, ctx)
    prof = electric.profile(req.iso3)
    shocks = {}
    for name, spec in electric.SHOCKS.items():
        si = electric.shock_inputs(name)
        r = electric.simulate(ctx, a, b["total"], split, si["factor"], si["capex_mult"], si["extra_delay"])
        after = y10(r)
        shocks[name] = {**spec, "before": last, "after": after,
                        "path": [{"year": t + 1, "access_pct": float(r["access_pct"][0, t]), "clean_pct": float(r["clean_pct"][0, t])}
                                 for t in range(electric.YEARS)],
                        "note": f"Electricity access in year 10: {last['access_pct']:.1f}% planned, {after['access_pct']:.1f}% after this shock."}
    factor = electric.budget_futures(req.iso3, b)
    mc = electric.simulate(ctx, a, b["total"], split, factor)
    acc10, clean10 = mc["access_pct"][:, -1], mc["clean_pct"][:, -1]
    hist = model.country_rows(req.iso3).dropna(subset=["gdp_usd"])
    return Simulation(
        budget=b, split=dict(zip(electric.BUCKETS, (split * 100).tolist())),
        split_amounts=dict(zip(electric.BUCKETS, (split * b["total"]).tolist())),
        recommendation=rec,
        start={"access": ctx["access0"], "access_year": prof["access"]["year"], "clean": ctx["renew0"], "clean_year": prof["clean"]["year"],
               "urban": prof["urban"], "rural": prof["rural"]},
        years=rows,
        cards={
            "solar": {"mw": last["solar_mw"], "capex": float(base["solar_capex"][0, -1]), "payback": pay["solar"],
                      "mwh": float(base["solar_mwh"][0, -1]), "site": prof["resources"]["solar"]},
            "wind": {"mw": last["wind_mw"], "turbines": last["wind_mw"] / a["mw_per_turbine"], "capex": float(base["wind_capex"][0, -1]),
                     "payback": pay["wind"], "capacity_factor": pay["wind_cf"], "mw_per_turbine": a["mw_per_turbine"],
                     "site": prof["resources"]["wind"]},
            "grid": {"km": last["line_km"], "storage_mwh": last["storage_mwh"], "capex": float(base["grid_capex"][0, -1]),
                     "households": last["line_km"] * a["households_per_km"]},
            "access": {"value": last["access_pct"], "clean": last["clean_pct"], "people": float(base["people_connected"][0, -1])},
        },
        limit=str(base["limit"][0, -1]),
        sites={"solar": prof["resources"]["solar"], "wind": prof["resources"]["wind"]},
        household_size=a["household_size"], shocks=shocks,
        futures={"runs": len(factor), "history_years": f"{int(hist.year.min())}–{int(hist.year.max())}" if len(hist) else "no",
                 "access_paths": np.round(mc["access_pct"], 2).tolist(), "clean_paths": np.round(mc["clean_pct"], 2).tolist(),
                 "access_p10": float(np.percentile(acc10, 10)), "access_p50": float(np.percentile(acc10, 50)),
                 "access_p90": float(np.percentile(acc10, 90)), "clean_p10": float(np.percentile(clean10, 10)),
                 "budget_p10": float(np.percentile(factor[:, -1], 10)), "budget_p90": float(np.percentile(factor[:, -1], 90))},
        meta=Meta(detail=f"500 budget futures from GDP and resource income history · 3 shocks", server_ms=(time.time() - start) * 1000),
    )


# ---------- Ask Nahda (AI advisor) ----------

ADVISOR_POOL = ThreadPoolExecutor(max_workers=2)
ADVISOR_DEADLINE_S = 20


class AdvisorRequest(BaseModel):
    iso3: str
    question: str = Field(..., min_length=2, max_length=500)
    kind: str | None = Field(None, description="mix | peer | siting, for the quick-question chips")
    split: dict[str, float] | None = None
    assumptions: dict[str, float] = {}


class AdvisorAnswer(BaseModel):
    answer: str
    sources: list[dict]
    mode: str
    label: str
    meta: Meta


def advisor_facts(req: AdvisorRequest) -> dict:
    c = country(req.iso3)
    p = peers(req.iso3)
    sim = simulate(SimulateRequest(iso3=req.iso3, split=req.split, assumptions=req.assumptions))
    return {"c": c, "p": p, "sim": sim, "a": electric.params(req.assumptions, req.iso3)}


def pct(v: float | None, d: int = 1) -> str:
    return "no data" if v is None else f"{v:.{d}f}%"


def advisor_data(f: dict) -> str:
    c, p, sim, a = f["c"], f["p"], f["sim"], f["a"]
    prof, cards = c.profile, sim.cards
    end = (sim.start["access_year"] or 2024) + 10
    r = prof["resources"]
    sites = sorted(r["sites"], key=lambda s: -s["solar"])
    lines = [
        f"Country: {c.name} ({c.iso3}); tier {c.tier}.",
        f"Electricity access: {pct(prof['access']['value'])} ({prof['access']['year']}); urban {pct(prof['urban']['value'])} ({prof['urban']['year']}); "
        f"rural {pct(prof['rural']['value'])} ({prof['rural']['year']}). Clean electricity share: {pct(prof['clean']['value'])} ({prof['clean']['year']}).",
        f"Best solar: {r['solar']['value']:.2f} kWh/m2/day at {r['solar']['site']}; best wind: {r['wind']['value']:.2f} m/s at 50 m at {r['wind']['site']} "
        f"(NASA POWER annual averages; thresholds {a['solar_threshold']:g} and {a['wind_threshold']:g}).",
        "All NASA sites (name: sunlight kWh/m2/day, 50 m wind m/s): " + "; ".join(f"{s['site']} ({s['lat']:.1f}, {s['lon']:.1f}): {s['solar']:.2f}, {s['wind']:.2f}" for s in sites) + ".",
        f"Yearly budget (estimate): ${sim.budget['total'] / 1e9:.2f} billion = {sim.budget['gdp']['share']:.1%} of GDP"
        + (f" + {sim.budget['resource']['share']:.0%} of {sim.budget['resource']['word']} income." if sim.budget["resource"]["amount"] else "."),
        f"Recommendation: {sim.recommendation['banner']}",
        f"Current plan: solar {sim.split['solar']:.0f}%, wind {sim.split['wind']:.0f}%, grid & storage {sim.split['grid']:.0f}%. By {end} (estimates): "
        f"{cards['solar']['mw']:,.0f} MW solar, {cards['wind']['mw']:,.0f} MW wind (~{cards['wind']['turbines']:,.0f} turbines), "
        f"{cards['grid']['km']:,.0f} km of lines, {cards['grid']['storage_mwh']:,.0f} MWh storage, access {pct(cards['access']['value'])}, clean share {pct(cards['access']['clean'])}.",
        "Peers that closed their gap (World Bank data):" if p.peers else "No peer meets the selection rule.",
        *[f"- {x['country']} from {x['year']} ({x['similarity']:.0f}% match): {x['changed']} {x['result']}." for x in p.peers],
        f"Peer playbook: {p.playbook['line']}" if p.playbook else "",
        "Solar and wind are variable sources, not baseload; storage and the grid cover gaps.",
    ]
    return "\n".join(x for x in lines if x)


def advisor_offline(req: AdvisorRequest, f: dict) -> str:
    """Instant answer from app data only, for when no AI service is reachable."""
    c, p, sim, a = f["c"], f["p"], f["sim"], f["a"]
    r = c.profile["resources"]
    q = req.question.lower()
    kind = req.kind or ("peer" if "peer" in q or "expand" in q else "siting" if "place" in q or "where" in q else "mix")
    if kind == "peer":
        if not p.peers:
            return f"No peer meets the selection rule for {c.name} ({PEER_RULE.split(': ')[1]})"
        x = p.peers[0]
        return f"{x['country']} from {x['year']}: {x['changed']} {x['result']}." + (f" {p.playbook['line']}" if p.playbook else "")
    if kind == "siting":
        top_sun = sorted(r["sites"], key=lambda s: -s["solar"])[:2]
        top_wind = sorted(r["sites"], key=lambda s: -s["wind"])[:2]
        return ("Strongest sunlight: " + ", ".join(f"{s['site']} ({s['solar']:.1f} kWh/m²/day)" for s in top_sun)
                + ". Strongest wind at 50 m: " + ", ".join(f"{s['site']} ({s['wind']:.1f} m/s)" for s in top_wind)
                + ". These are NASA point averages; actual sites need local resource, land and grid studies.")
    return (f"{c.name}'s best sunlight is {r['solar']['value']:.1f} kWh/m²/day ({electric.sun_word(r['solar']['value'], a)}) and best 50 m wind "
            f"{r['wind']['value']:.1f} m/s ({electric.wind_word(r['wind']['value'], a)}). {sim.recommendation['banner']} Both are variable, so "
            f"grid & storage carry the power to homes and cover gaps.")


@app.post("/api/advisor", response_model=AdvisorAnswer)
def ask_advisor(req: AdvisorRequest):
    """Short answer for the selected country. AI keys stay on the server; falls back to app data offline."""
    check(req.iso3)
    start = time.time()
    f = advisor_facts(req)
    job = ADVISOR_POOL.submit(advisor.ask, req.question, advisor_data(f))
    try:  # never keep the demo waiting: past the deadline, answer from app data
        out = job.result(timeout=ADVISOR_DEADLINE_S)
    except FutureTimeout:
        out = {"answer": None, "sources": [], "mode": "offline", "label": advisor.OFFLINE, "errors": [f"AI over {ADVISOR_DEADLINE_S}s"]}
    if out["answer"] is None:
        out.update(answer=advisor_offline(req, f), label=advisor.OFFLINE)
    detail = {"web": "Gemini + Google Search", "model": "Gemini (search unavailable)", "offline": "offline template"}[out["mode"]]
    return AdvisorAnswer(answer=out["answer"], sources=out["sources"], mode=out["mode"], label=out["label"],
                         meta=Meta(detail=f"advisor · {detail}" + (f" · {out['errors'][0]}" if out["errors"] else ""),
                                   server_ms=(time.time() - start) * 1000))


@app.get("/api/assumptions")
def assumptions():
    return electric.ASSUMPTIONS


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}
