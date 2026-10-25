"""Nahda backend: electrification planner. Run with: uvicorn main:app --reload --port 8000

Helps countries below 90% electricity access close the gap: peers that succeeded, and a solar / wind / grid & storage
mix from real resource data. Everything is computed from local files in data/ and ml/models/; only the optional
Ask Nahda advisor calls an external AI service."""

import json
import os
import re
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
    print(f"Gemini key loaded: {'yes' if os.getenv('GEMINI_API_KEY') else 'no'} · model {advisor.GEMINI_MODEL}", flush=True)
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


def why_match(iso3: str, name: str, peer: dict) -> str:
    """Plain sentence on why a peer matches, from the features the matching actually compared (at the end of each
    5-year path): access, urban and rural access, clean share, income per person, population. Picks the 3 closest."""
    snap, y = electric.snapshot_year(iso3), peer["year"]
    me = lambda col: electric.at(iso3, col, snap)["value"]  # noqa: E731
    them = lambda col: electric.at(peer["iso3"], col, y)["value"]  # noqa: E731
    stats = ML["peers"].stats
    options = []

    def add(col, phrase, scale_col=None):
        a, b = them(col), me(col)
        if a is None or b is None:
            return
        sd = stats.get(scale_col or col, (0, 1))[1] or 1
        options.append((abs(a - b) / sd, phrase(a, b)))

    add("electricity_access_pct", lambda a, b: f"a similar share of people with power ({a:.0f}% vs {b:.0f}%)")
    rural_y = electric.at(peer["iso3"], "rural_access_pct", y)
    rural_me = electric.profile(iso3)["rural"]["value"]
    if rural_y["value"] is not None and rural_me is not None and rural_y["year"] == y:
        sd = stats.get("rural_access_pct", (0, 1))[1] or 1
        options.append((abs(rural_y["value"] - rural_me) / sd,
                        f"a similar rural gap ({100 - rural_y['value']:.0f}% vs {100 - rural_me:.0f}% of rural people without power)"))
    add("urban_access_pct", lambda a, b: f"similar power in cities ({a:.0f}% vs {b:.0f}%)")
    small = lambda v: f"{v:.2f}%" if v < 1 else f"{v:.1f}%"  # noqa: E731
    add("renewable_electricity_pct", lambda a, b: (f"a small clean share ({small(a)} vs {small(b)})" if max(a, b) < 10
                                                   else f"a similar clean share ({a:.0f}% vs {b:.0f}%)"))
    gdp_a, gdp_b = them("gdp_per_capita_usd"), me("gdp_per_capita_usd")
    if gdp_a and gdp_b:
        sd = stats.get("log_gdp_per_capita", (0, 1))[1] or 1
        options.append((abs(np.log10(gdp_a) - np.log10(gdp_b)) / sd, f"similar income per person (${gdp_a:,.0f} vs ${gdp_b:,.0f})"))
    pop_a, pop_b = them("population"), me("population")
    if pop_a and pop_b:
        sd = stats.get("log_population", (0, 1))[1] or 1
        options.append((abs(np.log10(pop_a) - np.log10(pop_b)) / sd, f"a similar population ({pop_a / 1e6:.1f} vs {pop_b / 1e6:.1f} million)"))
    best = [ph for _, ph in sorted(options)[:3]]
    if not best:
        return f"{peer['country']} in {y} followed a similar 5-year electricity path to {name}'s."
    listed = ", ".join(best[:-1]) + (", and " if len(best) > 1 else "") + best[-1]
    return f"{peer['country']} in {y} looked like {name} in {snap}: {listed}."


@app.get("/api/peers/{iso3}/{peer}/web")
def peer_web(iso3: str, peer: str, year: int):
    """One concrete example of what the peer did in its 10-year window, from Google Search (cached per peer)."""
    check(iso3)
    if not model.known(peer):
        raise HTTPException(404, f"No data for {peer}")
    pname = model.latest(peer)["country"]
    out = advisor.web(f"peer:{peer}:{year}", f"Between {year} and {year + 10}, what was one concrete thing {pname} did to expand "
                                             f"electricity access (a program, policy, or project)? Give one example with its name and years.")
    return {"peer": peer, "years": [year, year + 10], **out}


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
    name = model.latest(iso3)["country"]
    for p in ps:
        p["lesson"] = lesson(iso3, p)
        p["why_match"] = why_match(iso3, name, p)
    top = (f"#1 match: {ps[0]['country']} from {ps[0]['year']}, then {ps[0]['access_change']:+.0f}% more people connected "
           f"within 10 years. {ps[0]['why_match']}") if ps else None
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

ON_TRACK = 0.9  # a plan stays on track if at least 90% of its planned spending happens


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
    # "Stays on track": the spending that really happens (reserve top-ups included) reaches 90% of the planned spending
    planned_total = b["total"] * electric.PHASE.sum() * (1 - split[4])
    on_track = float((mc["spend"].sum(axis=1) >= ON_TRACK * planned_total - 1e-6).mean()) if planned_total > 0 else 1.0
    rev = model.revenue_history(req.iso3)
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
                 "budget_p10": float(np.percentile(factor[:, -1], 10)), "budget_p90": float(np.percentile(factor[:, -1], 90)),
                 "on_track": on_track, "on_track_threshold": ON_TRACK, "block_years": 3, "drift_back": 0.3,
                 "resource_years": f"{rev[0]['year']}–{rev[-1]['year']}" if rev and b["resource"]["amount"] else None,
                 "resource_word": b["resource"]["word"]},
        meta=Meta(detail=f"500 budget futures from GDP and resource income history · 3 shocks", server_ms=(time.time() - start) * 1000),
    )


# ---------- Ask Nahda (AI advisor) ----------

ADVISOR_POOL = ThreadPoolExecutor(max_workers=2)
ADVISOR_DEADLINE_S = 20


class AdvisorRequest(BaseModel):
    iso3: str | None = None
    question: str = Field(..., min_length=1, max_length=500)
    kind: str | None = Field(None, description="first | peer | mix | risk | siting | peer_web")
    split: dict[str, float] | None = None
    assumptions: dict[str, float] = {}


class AdvisorAnswer(BaseModel):
    answer: str
    sources: list[dict]
    mode: str
    label: str
    note: str | None = None  # why AI or web search was unavailable, shown in the panel
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
        f"Current plan: solar {sim.split['solar']:.0f}%, wind {sim.split['wind']:.0f}%, grid lines {sim.split['grid']:.0f}%, battery storage {sim.split['storage']:.0f}%, reserve {sim.split['reserve']:.0f}%. By {end} (estimates): "
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


def greet(name: str | None) -> str:
    if name:
        return (f"Hi! I can help you plan how {name} gets more people connected: ask what to do first, why its top peer "
                f"succeeded, whether solar or wind fits better, or what could go wrong.")
    return "Hi! Pick a country on the globe or a quick pick, and I'll help plan how it gets more people connected."


def advisor_offline(req: AdvisorRequest, f: dict) -> str:
    """Instant answer from app data only, for when no AI service is reachable."""
    c, p, sim, a = f["c"], f["p"], f["sim"], f["a"]
    r = c.profile["resources"]
    q = req.question.lower()
    kind = req.kind or ("peer" if "peer" in q or "succeed" in q or "expand" in q else "risk" if "wrong" in q or "risk" in q
                        else "first" if "first" in q else "siting" if "place" in q or "where" in q else "mix")
    if kind == "first":
        rec = sim.recommendation
        return (" ".join(rec["banner"][1:2]) + " " + rec["banner"][0]
                + (f" Lesson from {p.peers[0]['country']}: {p.peers[0]['lesson']}" if p.peers else ""))
    if kind == "risk":
        worst = min(sim.shocks.values(), key=lambda s: s["after"]["access_pct"])
        return (f"The biggest single risk is \"{worst['label']}\": access in year 10 would reach {worst['after']['access_pct']:.0f}% "
                f"instead of {worst['before']['access_pct']:.0f}%. In 9 of 10 budget futures access still reaches "
                f"{sim.futures['access_p10']:.0f}%. Solar and wind are variable, so the plan keeps storage and a "
                f"{sim.split['reserve']:.0f}% reserve." + (f" Warning: {sim.guardrails[0]}" if sim.guardrails else ""))
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
            f"{r['wind']['value']:.1f} m/s ({electric.wind_word(r['wind']['value'], a)}). {sim.recommendation['banner'][0]} Both are variable, so "
            f"grid & storage carry the power to homes and cover gaps.")


@app.get("/api/advisor/status")
def advisor_status():
    """Whether an AI key is configured and what the last answer used (web search, AI only, or offline)."""
    return advisor.status()


@app.post("/api/advisor", response_model=AdvisorAnswer)
def ask_advisor(req: AdvisorRequest):
    """Short answer for the selected country. AI keys stay on the server; falls back to app data offline."""
    start = time.time()
    name = model.latest(req.iso3)["country"] if req.iso3 and model.known(req.iso3) else None
    if GREETING.match(req.question) or not req.iso3:
        # Greetings get an instant friendly reply; without a country there is no data to reason about yet
        text = greet(name)  # with no country selected, greet() asks the user to pick one
        return AdvisorAnswer(answer=text, sources=[], mode="greeting", label="",
                             meta=Meta(detail="advisor · greeting", server_ms=(time.time() - start) * 1000))
    check(req.iso3)
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
                         note="; ".join(out["errors"]) if out["errors"] else None,
                         meta=Meta(detail=f"advisor · {detail}" + (f" · {out['errors'][0]}" if out["errors"] else ""),
                                   server_ms=(time.time() - start) * 1000))


# ---------- AI recommendation (Plan tab) ----------

class RecommendationRequest(BaseModel):
    iso3: str
    split: dict[str, float] | None = None
    assumptions: dict[str, float] = {}


def data_facts(iso3: str, sim) -> list[str]:
    """'From the data': numbers from World Bank and NASA only, no AI."""
    prof = electric.profile(iso3)
    r = prof["resources"]
    name = model.latest(iso3)["country"]
    acc, urb, rur, cln = (prof[k]["value"] for k in ["access", "urban", "rural", "clean"])
    out = [f"In {prof['year']}, {acc:.1f}% of people in {name} had electricity"
           + (f" ({urb:.0f}% in cities" + (f", {rur:.0f}% in rural areas)." if rur is not None else
                                            f"; rural access has no data since {prof['rural'].get('last_measured')}).") if urb is not None else ".")
           + " (World Bank)",
           f"Clean sources made {cln:.2f}% of its electricity (World Bank, {prof['year']})." if cln is not None and cln < 1
           else f"Clean sources made {cln:.0f}% of its electricity (World Bank, {prof['year']})." if cln is not None else "",
           f"Strongest sunlight: {r['solar']['value']:.1f} kWh/m²/day at {r['solar']['site']}; strongest 50 m wind: "
           f"{r['wind']['value']:.1f} m/s at {r['wind']['site']} (NASA POWER).",
           f"Yearly budget about ${sim.budget['total'] / 1e9:.2f} billion (estimate from World Bank GDP and resource income)."]
    return [x for x in out if x]


@app.post("/api/recommendation")
def recommendation(req: RecommendationRequest):
    """Three labelled parts: From the data (no AI), Analysis (AI, cached per country and split), From the web (Google
    Search, cached per country). AI is never called on every slider tick: the frontend asks only on demand."""
    check(req.iso3)
    start = time.time()
    sim = simulate(SimulateRequest(iso3=req.iso3, split=req.split, assumptions=req.assumptions))
    split = {k: int(5 * round(v / 5)) for k, v in sim.split.items()}  # cache key: the split rounded to 5 points
    key = f"{req.iso3}:{split}:{sorted(req.assumptions.items())}"
    f = advisor_facts(AdvisorRequest(iso3=req.iso3, question="recommendation", split=req.split, assumptions=req.assumptions))
    ai = advisor.analysis(key, advisor_data(f))
    name = model.latest(req.iso3)["country"]
    r = electric.profile(req.iso3)["resources"]
    web = advisor.web(f"country:{req.iso3}", f"What solar or wind power projects exist or are planned in {name} (for example near "
                                            f"{r['solar']['site']} or {r['wind']['site']}), and what has held back electricity supply there?")
    return {"split_used": sim.split, "data": data_facts(req.iso3, sim), "analysis": ai, "web": web,
            "offline": sim.recommendation["banner"], "server_ms": (time.time() - start) * 1000}


@app.get("/api/assumptions")
def assumptions():
    return electric.ASSUMPTIONS


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}
