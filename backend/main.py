"""Nahda backend: electrification planner. Run with: uvicorn main:app --reload --port 8000

Helps countries below 90% electricity access close the gap: peers that succeeded, and a solar / wind / grid & storage
mix from real resource data. Everything is computed from local files in data/ and ml/models/; only the optional
Ask Nahda advisor calls an external AI service."""

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from contextlib import asynccontextmanager
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import advisor
import cards
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
    first = w.quick_picks[0]["iso3"] if w.quick_picks else None
    if first:  # the first quick pick, end to end (also warms SHAP and LightGBM, whose first call is slow)
        country(first)
        peers(first)
        simulate(SimulateRequest(iso3=first))
    print(f"Models loaded in {time.time() - start:.1f}s · {len(ML['peers'].windows)} peer windows · preloaded {first or 'nothing'}")
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
# The demo's featured countries, in order (a presentation choice, not data); any not below 90% access are skipped
HERO_COUNTRIES = ["LBY", "NGA", "KEN", "BWA", "CIV"]
QUICK_PICK_RULE = ("Featured demo countries, all below 90% electricity access; the remaining slots, if any, go to the countries "
                   "below 90% with the most World Bank values since 2000 plus NASA sites.")


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
    hero = [p for iso in HERO_COUNTRIES for p in picks if p["iso3"] == iso]
    picks = (hero + sorted((p for p in picks if p["iso3"] not in HERO_COUNTRIES), key=lambda p: -p["coverage"]))[:5]
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
    result = (f"{a1 - a0:+.0f}% more people connected ({a0:.0f}% → {a1:.0f}%)"
              + (f" · clean share {c['from']:.0f}% → {c['to']:.0f}%" if c["from"] is not None else ""))
    return {**p, "urban_gain": urban, "rural_gain": rural, "clean_gain": clean, "changed": changed, "result": result,
            "access_change": a1 - a0, "detail": peer_story(p, ch)}


def peer_story(p: dict, ch: dict) -> dict:
    """The peer's 10-year series, three data bullets, an honest clean-power trade-off, all from World Bank data."""
    y0, y1 = p["year"], p["year"] + 10
    m = electric.merged(p["iso3"])
    w = m[(m.year >= y0) & (m.year <= y1)]
    num = lambda v: None if pd.isna(v) else round(float(v), 2)  # noqa: E731
    series = [{"year": int(r.year), "total": num(r.electricity_access_pct), "rural": num(r.rural_access_pct),
               "urban": num(r.urban_access_pct), "clean": num(r.renewable_electricity_pct)} for r in w.itertuples()]
    f = lambda v: f"{v:.0f}%" if abs(v) >= 10 else f"{v:.1f}%"  # noqa: E731
    bullets = []
    r, u = ch["rural_access_pct"], ch["urban_access_pct"]
    if r["from"] is not None and u["from"] is not None:
        city_share = electric.at(p["iso3"], "urban_pct", y0)["value"]
        city_share = 50.0 if city_share is None else city_share
        # Who gained more people: rural gain x rural population share vs urban gain x urban share
        from_villages = (r["to"] - r["from"]) * (100 - city_share) >= (u["to"] - u["from"]) * city_share
        bullets.append(f"Rural access rose from {f(r['from'])} to {f(r['to'])} while cities went from {f(u['from'])} to {f(u['to'])}: "
                       f"most of the gain came from {'villages, not cities' if from_villages else 'cities, not villages'}.")
    else:
        bullets.append("No urban and rural split was measured for these years.")
    c = ch["renewable_electricity_pct"]
    if c["from"] is None:
        # Clean share often stops before the window ends: use the first and last measured years inside it, named
        cs = [(x["year"], x["clean"]) for x in series if x["clean"] is not None]
        if len(cs) >= 2:
            c = {"from": cs[0][1], "to": cs[-1][1], "from_year": cs[0][0], "to_year": cs[-1][0]}
    if c["from"] is not None:
        verb = "rose" if c["to"] - c["from"] >= 0.5 else "fell" if c["to"] - c["from"] <= -0.5 else "held"
        span = "" if (c.get("from_year"), c.get("to_year")) == (y0, y1) or c.get("from_year") is None else f" ({c['from_year']}–{c['to_year']})"
        bullets.append(f"Clean electricity {verb} {'at about ' + f(c['to']) if verb == 'held' else 'from ' + f(c['from']) + ' to ' + f(c['to'])} "
                       f"of the power supply{span}.")
    inv = ch["fixed_investment_pct_gdp"]
    if inv["from"] is not None:
        bullets.append(f"Investment went from {f(inv['from'])} to {f(inv['to'])} of the economy.")
    g = differences.change(p["iso3"], "gdp_per_capita_usd", y0, y1)
    if len(bullets) < 3 and g["from"]:
        bullets.append(f"Income per person went from ${g['from']:,.0f} to ${g['to']:,.0f}.")
    tradeoff = None
    if c["from"] is not None and p["access"][-1] > p["access"][0] and c["to"] - c["from"] <= -2:
        tradeoff = (f"Connected more people while its clean share fell from {f(c['from'])} to {f(c['to'])}, "
                    "so fossil fuel generation grew faster than clean power.")
    return {"years": [y0, y1], "series": series, "bullets": bullets[:3], "tradeoff": tradeoff,
            "from_villages": bool(r["from"] is not None and u["from"] is not None and "villages, not" in bullets[0])}


def lesson(iso3: str, peer: dict) -> str:
    """One sentence linking the peer's data to the selected country's own data."""
    name = model.latest(iso3)["country"]
    prof = electric.profile(iso3)
    acc, rur, urb = prof["access"]["value"], prof["rural"]["value"], prof["urban"]["value"]
    a = electric.params(iso3=iso3)
    sun = prof["resources"]["solar"]
    if peer["detail"]["from_villages"] and rur is not None and urb is not None and urb - rur >= 15:
        return (f"Like {peer['country']}, {name}'s gap is mostly rural ({rur:.0f}% rural vs {urb:.0f}% urban access), "
                f"so lines to villages are where the gains are.")
    if (peer["clean_gain"] or 0) >= 5 and sun and sun["value"] >= a["solar_threshold"]:
        return (f"{peer['country']} raised its clean share while connecting people; {name}'s {electric.sun_word(sun['value'], a)} "
                f"({sun['value']:.1f} kWh/m²/day) makes the same possible with solar.")
    target = min(100.0, (acc or 0) + peer["access_change"])
    return (f"{peer['country']} connected {peer['access_change']:+.0f}% more people in 10 years; the same pace would take "
            f"{name} from {acc:.0f}% to about {target:.0f}%.")


RANK_RULE = " Ranked 60% by similarity and 40% by the 10-year gain."


class Peers(BaseModel):
    year: int
    access_now: float
    top: str | None
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
    found = ML["peers"].find_peers(iso3, k=8, end_year=electric.snapshot_year(iso3))
    if found is None:
        raise HTTPException(404, f"Not enough history to find peers for {iso3}")
    # Rank by similarity AND 10-year gain: 60% similarity, 40% gain (gains above 40 points count as 40)
    for p in found["peers"]:
        p["rank_score"] = 0.6 * p["similarity"] / 100 + 0.4 * min(40.0, p["access"][-1] - p["access"][0]) / 40
    ps = [peer_details(p) for p in sorted(found["peers"], key=lambda p: -p["rank_score"])[:3]]
    for p in ps:
        p["lesson"] = lesson(iso3, p)
    name = model.latest(iso3)["country"]
    top = (f"#1 match: {ps[0]['country']} from {ps[0]['year']}, a {ps[0]['similarity']:.0f}% similar path to {name}'s, "
           f"then {ps[0]['access_change']:+.0f}% more people connected within 10 years.") if ps else None
    playbook = None
    if ps:
        a = electric.params(iso3=iso3)
        rec = electric.recommend(iso3, a, electric.budget(iso3, a)["total"], ps[0])
        playbook = {"peer": ps[0]["iso3"], "peer_name": ps[0]["country"], "peer_year": ps[0]["year"], "split": rec["split"], "line": rec["line"]}
    return Peers(year=found["year"], access_now=found["access_now"], peers=ps, rule=PEER_RULE + RANK_RULE, playbook=playbook, top=top,
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
    guardrails: list[str]
    current: list[str]
    phased: list[dict]
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
    split_pct = dict(zip(electric.BUCKETS, (split * 100).tolist()))
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
        budget=b, split=split_pct,
        split_amounts=dict(zip(electric.BUCKETS, (split * b["total"]).tolist())),
        recommendation=rec, guardrails=electric.guardrails(a, split_pct),
        current=electric.explain(req.iso3, a, {k: int(round(v)) for k, v in split_pct.items()}, {}),
        phased=electric.phased(b["total"], split),
        start={"access": ctx["access0"], "access_year": ctx["year"], "clean": ctx["renew0"], "clean_year": ctx["year"],
               "urban": prof["urban"], "rural": prof["rural"], "snapshot": prof["year"]},
        years=rows,
        cards={
            "solar": {"mw": last["solar_mw"], "capex": float(base["solar_capex"][0, -1]), "payback": pay["solar"],
                      "mwh": float(base["solar_mwh"][0, -1]), "site": prof["resources"]["solar"]},
            "wind": {"mw": last["wind_mw"], "turbines": last["wind_mw"] / a["mw_per_turbine"], "capex": float(base["wind_capex"][0, -1]),
                     "payback": pay["wind"], "capacity_factor": pay["wind_cf"], "mw_per_turbine": a["mw_per_turbine"],
                     "site": prof["resources"]["wind"]},
            "grid": {"km": last["line_km"], "storage_mwh": last["storage_mwh"], "capex": float(base["grid_capex"][0, -1]),
                     "households": last["line_km"] * a["households_per_km"],
                     "lines_pct": base["lines_share"] * 100, "storage_pct": base["storage_share"] * 100},
            "reserve": {"left": float(base["reserve"][0, -1]), "drawn": float(base["reserve_drawn"][0, -1])},
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
    iso3: str | None = None
    question: str = Field(..., min_length=1, max_length=500)
    kind: str | None = Field(None, description="first | peer | people | mix | risk | siting | least | comeback | method")
    split: dict[str, float] | None = None
    assumptions: dict[str, float] = {}
    previous: str | None = Field(None, max_length=4000, description="the chat's last reply, so it is never repeated")


class AdvisorAnswer(BaseModel):
    answer: str
    sources: list[dict]
    mode: str
    label: str
    # The answer card: verdict, 2-3 facts ({icon, label, value, detail}), why, source. None for greetings.
    card: dict | None = None
    # Set when the message named a country: the app selects it (flies to it, opens its panel); the answer is about it
    select: dict | None = None
    # Questions to offer as clickable chips under this reply
    suggestions: list[str] = []
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
        f"Recommendation: {' '.join(sim.recommendation['banner'])}",
        f"Current plan: solar {sim.split['solar']:.0f}%, wind {sim.split['wind']:.0f}%, grid & storage {sim.split['grid']:.0f}%, reserve {sim.split['reserve']:.0f}%. By {end} (estimates): "
        f"{cards['solar']['mw']:,.0f} MW solar, {cards['wind']['mw']:,.0f} MW wind (~{cards['wind']['turbines']:,.0f} turbines), "
        f"{cards['grid']['km']:,.0f} km of lines, {cards['grid']['storage_mwh']:,.0f} MWh storage, access {pct(cards['access']['value'])}, clean share {pct(cards['access']['clean'])}.",
        "Peers that closed their gap (World Bank data):" if p.peers else "No peer meets the selection rule.",
        *[f"- {x['country']} from {x['year']} ({x['similarity']:.0f}% match): {x['changed']} {x['result']}."
          + (f" Trade-off: {x['detail']['tradeoff']}" if x['detail']['tradeoff'] else "") + f" Lesson: {x['lesson']}" for x in p.peers],
        f"Top peer: {p.peers[0]['country']} ({p.top})" if p.peers else "",
        "Plan warnings: " + (" ".join(sim.guardrails) if sim.guardrails else "none (within the safe portfolio limits)."),
        "Single shocks, access in year 10: " + "; ".join(f"{s['label']} {s['after']['access_pct']:.0f}% (planned {s['before']['access_pct']:.0f}%)" for s in sim.shocks.values()) + ".",
        f"Peer playbook: {p.playbook['line']}" if p.playbook else "",
        "Solar and wind are variable sources, not baseload; storage and the grid cover gaps.",
    ]
    return "\n".join(x for x in lines if x)


GREETING = re.compile(r"^\s*(hi|hello|hey|hiya|salam|salaam|assalamu alaikum|marhaba|good (morning|afternoon|evening)|yo|sup)\b[\s!.,?]*$", re.I)
STARTERS = ["Which countries have the least electricity?", "Show me a comeback story", "How does Nahda pick a twin?"]
WORLD_KINDS = ("least", "comeback", "method")


@lru_cache(maxsize=1)
def world_rows() -> list[dict]:
    """Every country with data: latest electricity access and its year, lowest first."""
    meta = pd.read_csv(model.DATA / "country_meta.csv").set_index("iso3")
    rows = []
    for iso3 in {iso for _, iso in cards.country_names()}:
        lat = model.latest(iso3)
        if lat["electricity_access_pct"] is None:
            continue
        region = meta.region.get(iso3)
        rows.append({"iso3": iso3, "name": lat["country"], "access": lat["electricity_access_pct"],
                     "year": lat["electricity_access_pct_year"], "region": None if pd.isna(region) else str(region)})
    return sorted(rows, key=lambda r: r["access"])


@lru_cache(maxsize=1)
def comeback_story() -> dict | None:
    """The biggest 10-year gain among the #1 peers of countries below 60% access: a real comeback, with the country
    it is a lesson for."""
    best = None
    for r in world_rows():
        if r["access"] >= 60:
            break
        try:
            ps = peers(r["iso3"]).peers
        except HTTPException:
            continue
        if ps and (best is None or ps[0]["access_change"] > best[0]["access_change"]):
            best = (ps[0], r)
    if best is None:
        return None
    x, r = best
    rural = [s["rural"] for s in x["detail"]["series"] if s.get("rural") is not None]
    return {"peer": x["country"], "peer_iso3": x["iso3"], "year": x["year"], "from": x["access"][0], "to": x["access"][-1],
            "gain": x["access_change"], "rural": (rural[0], rural[-1]) if len(rural) >= 2 and rural[-1] - rural[0] >= 3 else None,
            "for_name": r["name"], "for_iso3": r["iso3"], "for_access": r["access"]}


def chips_for(iso3: str) -> list[str]:
    """The four starter questions for a country, as the chat shows them."""
    c = country(iso3)
    p = peers(iso3).peers
    end = (c.profile.get("year") or datetime.now().year) + 10
    return [f"What should {c.name} do first?", f"What did {p[0]['country']} do differently?" if p else "Which country closed a gap like this?",
            f"How many people would get power by {end}?", "How reliable is this plan?"]


GREETINGS = ["Hi! Ask me about any country's electricity, or try one of these:",
             "Hello! I can explain who lacks power and how countries catch up. Try:"]
GREETINGS_COUNTRY = ["Hi! Ask me anything about {name}'s plan, or start here:",
                     "Hello! Here's what I can tell you about {name}:"]
HELP = ("I didn't catch that. I can tell you which countries have the least electricity, show a comeback story, "
        "explain how Nahda picks a twin, or answer about any country you name. Try:")
HELP_AGAIN = ("Still not sure what you mean. Name a country (like Sudan or Nigeria), or pick a question:")
HELP_COUNTRY = ("I didn't catch that. For {name} I can say what to do first, what its top peer did differently, how many "
                "people the plan connects and how reliable it is. Try:")
HELP_COUNTRY_AGAIN = "Still not sure what you mean. Try one of these about {name}, or name another country:"
SAME = "That's the same answer as just above. Here's what else I can tell you:"


def pick(options: list[str], previous: str | None) -> str:
    """The first wording that differs from the last reply, so the chat never repeats itself word for word."""
    return next((o for o in options if o != previous), options[0])


def text_answer(text: str, suggestions: list[str], start: float, detail: str, select: dict | None = None) -> "AdvisorAnswer":
    return AdvisorAnswer(answer=text, sources=[], mode="greeting", label="", suggestions=suggestions, select=select,
                         meta=Meta(detail=f"advisor · {detail}", server_ms=(time.time() - start) * 1000))


def card_answer(card: dict, start: float, detail: str, *, suggestions: list[str] | None = None, select: dict | None = None,
                mode: str = "offline", label: str = "", sources: list[dict] | None = None) -> "AdvisorAnswer":
    return AdvisorAnswer(answer=" ".join(x for x in (card["verdict"] + ".", card["why"]) if x), sources=sources or [], mode=mode,
                         label=label or advisor.OFFLINE, card=card, select=select, suggestions=suggestions or [],
                         meta=Meta(detail=f"advisor · {detail}", server_ms=(time.time() - start) * 1000))


@app.get("/api/advisor/status")
def advisor_status():
    """Whether an AI key is configured and what the last answer used (web search, AI only, or offline)."""
    return advisor.status()


@app.post("/api/advisor", response_model=AdvisorAnswer)
def ask_advisor(req: AdvisorRequest):
    """Answer cards from app data (AI first when a key is set). A country named anywhere in the message is selected
    and answered about; without a country the chat answers world questions; greetings and unclear messages get a
    short reply with suggested questions. Never returns the same reply twice in a row."""
    start = time.time()
    q = req.question
    named = cards.find_country(q)
    if named and req.iso3 and named != req.iso3 and named in {x["iso3"] for x in peers(req.iso3).peers}:
        named = None  # "What did Cambodia do differently?" is about the open country's own peer, not a switch
    if named == req.iso3:
        named = None  # already selected
    target = named or req.iso3
    select = {"iso3": named, "name": model.latest(named)["country"]} if named else None
    kind = req.kind or cards.kind_of(q)
    if named and not req.kind and kind in (None, *WORLD_KINDS):
        kind = "first"  # "Sudan" on its own, or "tell me about Sudan": the country's overview

    def finish(out: AdvisorAnswer) -> AdvisorAnswer:
        if out.answer != req.previous:
            return out
        return text_answer(SAME, chips_for(target) if target else STARTERS, start, "repeat avoided", out.select)

    if GREETING.match(q):
        name = model.latest(target)["country"] if target else None
        text = pick([g.format(name=name) for g in GREETINGS_COUNTRY] if name else GREETINGS, req.previous)
        return finish(text_answer(text, chips_for(target) if target else STARTERS, start, "greeting", select))

    if kind in WORLD_KINDS:
        if kind == "least":
            rows = world_rows()
            return finish(card_answer(cards.least(rows), start, "world card (least)",
                                      suggestions=[f"Tell me about {r['name']}" for r in rows[:3]]))
        if kind == "comeback":
            s = comeback_story()
            if s is None:
                return finish(text_answer("No comeback story found in the data.", STARTERS, start, "comeback"))
            return finish(card_answer(cards.comeback(s), start, "world card (comeback)",
                                      suggestions=[f"Tell me about {s['for_name']}", "How does Nahda pick a twin?",
                                                   "Which countries have the least electricity?"]))
        return finish(card_answer(cards.method(), start, "world card (method)", suggestions=[x for x in STARTERS if "twin" not in x]))

    if target is None:
        return finish(text_answer(pick([HELP, HELP_AGAIN], req.previous), STARTERS, start, "help"))
    check(target)
    if kind is None:
        name = model.latest(target)["country"]
        return finish(text_answer(pick([HELP_COUNTRY.format(name=name), HELP_COUNTRY_AGAIN.format(name=name)], req.previous),
                                  chips_for(target), start, "help", select))

    if named:  # answered about the newly selected country, with its own default plan
        req = req.model_copy(update={"iso3": named, "split": None, "assumptions": {}})
    if kind == "peer_web":
        kind = "peer"
    f = advisor_facts(req)
    data = advisor_data(f)
    job = ADVISOR_POOL.submit(advisor.ask, q, data, cards.AI_FORMAT)
    try:  # never keep the demo waiting: past the deadline, answer from app data
        out = job.result(timeout=ADVISOR_DEADLINE_S)
    except FutureTimeout:
        out = {"answer": None, "sources": [], "mode": "offline", "label": advisor.OFFLINE, "errors": [f"AI over {ADVISOR_DEADLINE_S}s"]}
    card = cards.from_ai(out["answer"], data) if out["answer"] else None
    if card:
        card["source"] = "Source: World Bank & NASA POWER" + (" + web search" if out["sources"] else "")
    else:  # no AI, or its card failed the checks: the card built from data
        if out["answer"]:
            out["errors"].append("AI card failed checks")
        out.update(mode="offline", label=advisor.OFFLINE, sources=[])
        card = cards.build(kind, f["c"], f["p"], f["sim"], f["a"], model.latest(req.iso3)["population"])
    detail = {"web": "Gemini + Google Search", "model": "Gemini (search unavailable)", "offline": f"card from data ({kind})"}[out["mode"]]
    return finish(card_answer(card, start, detail + (f" · {out['errors'][0]}" if out["errors"] else ""), select=select,
                              mode=out["mode"], label=out["label"], sources=out["sources"]))


@app.get("/api/assumptions")
def assumptions():
    return electric.ASSUMPTIONS


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}
