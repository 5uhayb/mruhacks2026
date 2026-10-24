"""Nahda backend. Run with: uvicorn main:app --reload --port 8000"""

import asyncio
import os
from datetime import datetime

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from pydantic import BaseModel

import model
import notes
from notes import money

load_dotenv()  # API keys from backend/.env

GEMINI_MODEL = "gemini-flash-lite-latest"
GEMINI_FALLBACK_MODEL = "gemini-flash-latest"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Server still starts without a key; only the analyst Q&A needs it
gemini = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

app = FastAPI(title="Nahda API")

# Allow the Vite dev server to call the API directly too
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def check_country(iso3: str):
    countries, _, _ = model.load()
    if iso3 not in set(countries.iso3):
        raise HTTPException(404, f"Unknown country {iso3}")


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


@app.get("/api/meta")
def meta():
    return {
        "countries": [p for p in model.peers() if p["revenue_avg"] > 0],
        "assumptions": model.ASSUMPTIONS,
        "shocks": model.SHOCKS,
    }


# ---------- 1 SITUATION ----------

@app.get("/api/overview/{iso3}")
def overview(iso3: str):
    check_country(iso3)
    lat = model.latest(iso3)
    rb = model.revenue_baseline(iso3)
    best = model.sites_for(iso3).iloc[0]
    src = model.INDICATOR_META
    return {
        "iso3": iso3,
        "country": lat["country"],
        "data_as_of": max(rb["years"][-1], lat["electricity_access_pct_year"] or 0, lat["renewable_electricity_pct_year"] or 0),
        "tiles": {
            "oil": {"value": rb["avg"], "years": rb["years"], "per_person": rb["avg"] / lat["population"],
                    "note": notes.oil_money(iso3), "history": rb["history"],
                    "source": "5-year average of GDP × oil rents % (World Bank NY.GDP.MKTP.CD × NY.GDP.PETR.RT.ZS)",
                    "why": {
                        "words": "GDP × the share of GDP that comes from oil, averaged over the latest 5 years. "
                                 "This is oil profit for the whole economy, not the government budget.",
                        "symbols": "R̄ = (1/5) · Σ GDPₜ × rentsₜ",
                        "inputs": [{"label": str(r["year"]), "value": f"{money(r['gdp_usd'])} × {r['oil_rents_pct']:.1f}% = {money(r['revenue'])}",
                                    "source": "World Bank"} for r in rb["used"]],
                        "sensitivity": f"Which years you average. Latest year alone: {money(rb['used'][-1]['revenue'])}.",
                    }},
            "no_power": {"value": 100 - (lat["electricity_access_pct"] or 100), "year": lat["electricity_access_pct_year"],
                         "note": notes.no_power(iso3), "sparkline": model.series(iso3, "electricity_access_pct", 25),
                         "source": " — ".join(src["electricity_access_pct"])},
            "clean": {"value": lat["renewable_electricity_pct"] or 0, "year": lat["renewable_electricity_pct_year"],
                      "note": notes.clean(iso3), "nor": model.latest("NOR")["renewable_electricity_pct"],
                      "source": " — ".join(src["renewable_electricity_pct"])},
            "sun": {"site": best.site, "value": float(best.solar_kwh_m2_day), "note": notes.sun(iso3),
                    "source": model.SOLAR_SOURCE + " (kWh/m²/day)"},
        },
        "peers": model.peers(),
        "sites": [
            {"site": s.site, "lat": float(s.lat), "lon": float(s.lon), "solar": float(s.solar_kwh_m2_day),
             "wind": float(s.wind_50m_ms)} for s in model.sites_for(iso3).itertuples()
        ],
    }


# ---------- 2 PLAN + 4 STRESS ----------

class PlanRequest(BaseModel):
    iso3: str
    share: float = 0.10  # share of resource revenue diverted, 0-0.3
    split: dict[str, float] = {"solar": 40, "rail": 30, "fund": 30}
    site: str | None = None
    mw: float = model.FARM_MW
    assumptions: dict[str, float] = {}


def setup(req: PlanRequest):
    check_country(req.iso3)
    a = model.params(req.assumptions)
    sites = model.sites_for(req.iso3)
    site = req.site if req.site in set(sites.site) else sites.iloc[0].site
    kwh = float(sites.set_index("site").loc[site].solar_kwh_m2_day)
    return a, model.context(req.iso3, a), site, kwh, max(0.0, min(req.share, 0.3))


def year10(result: dict, i: int = 0) -> dict:
    last = model.rows(result, i)[-1]
    last["shortfall_total"] = float(result["shortfall"][i].sum())
    last["fully_funded"] = bool(result["fully_funded"][i])
    return last


@app.post("/api/plan")
def plan(req: PlanRequest):
    a, ctx, site, kwh, share = setup(req)
    split = model.normalize(req.split)
    base = model.simulate(ctx, a, share, split, kwh, np.ones((1, model.YEARS)))
    rows = model.rows(base)
    pool = share * ctx["base_revenue"]

    before = year10(base)
    before["deal_npv"] = model.deal(req.iso3, site, req.mw, a)["npv"]
    shocks = {}
    for name, spec in model.SHOCKS.items():
        si = model.shock_inputs(name)
        after = year10(model.simulate(ctx, a, share, split, kwh, si["rev_factor"], si["fuel_mult"], si["capex_mult"]))
        after["deal_npv"] = model.deal(req.iso3, site, req.mw, a, si["capex_mult"], float(si["fuel_mult"][0, 0]), si["rate_shift"])["npv"]
        shocks[name] = {**spec, "before": before, "after": after, "note": notes.shock(name, before, after, req.iso3)}

    ratios = model.oil_scenarios(500)
    mc = model.simulate(ctx, a, share, split, kwh, ratios, ratios)
    brent = model.annual_brent()
    return {
        "site": site,
        "goals": model.goals_meta(ctx),
        "route_km": ctx["route"]["km"],
        "today": model.goals_today(ctx),
        "base_revenue": ctx["base_revenue"],
        "pool": pool,
        "per_person": pool / ctx["population"],
        "split_amounts": dict(zip(model.SECTORS, (pool * split).tolist())),
        "years": rows,
        "shocks": shocks,
        "monte_carlo": {
            "runs": len(ratios),
            "p_funded": float(mc["fully_funded"].mean()),
            "p_goal": {k: float((mc[k][:, -1] >= 0.999).mean()) for k in model.GOAL_KEYS},
            "fund_bands": model.percentile_bands(mc["fund"]),
            "why": {
                "words": f"500 possible oil-price futures, made by replaying real yearly Brent price moves ({brent.index[1]}–{brent.index[-1]}). "
                         "Each year prices drift 30% back toward the 20-year median. 'Fully funded' means every year's solar "
                         "and rail spending was paid, from oil money or by drawing on savings.",
                "symbols": "P(funded) = share of futures with no shortfall",
                "inputs": [
                    {"label": "Price history", "value": f"{len(brent)} years", "source": "FRED Brent"},
                    {"label": "Start price", "value": f"${model.current_brent():.0f}/bbl", "source": "last 12 months"},
                    {"label": "20-yr median", "value": f"${brent.tail(20).median():.0f}/bbl", "source": "FRED Brent"},
                ],
                "sensitivity": "The savings share: more savings covers more bad years.",
            },
        },
    }


@app.post("/api/optimize")
def optimize(req: PlanRequest):
    a, ctx, _, kwh, share = setup(req)
    return model.optimize(ctx, a, share, kwh, req.split)


# ---------- 3 PROJECTS ----------

@app.post("/api/deal")
def deal(req: PlanRequest):
    a, _, site, _, _ = setup(req)
    d = model.deal(req.iso3, site, req.mw, a)
    lat, nor = model.latest(req.iso3), model.latest("NOR")
    return {
        **d,
        "notes": notes.deal_notes(d, a),
        "why": {
            "words": "Each year the farm earns the export value of the fuel it saves, minus running costs. "
                     "IRR = the yearly return on the build cost. Payback = years to earn the build cost back. "
                     "NPV = lifetime value today, at the country's cost of money.",
            "symbols": "0 = −CAPEX + Σₜ (MWhₜ × fuel/MWh × fuel price − O&M) / (1+IRR)ᵗ",
            "inputs": [
                {"label": "Sunlight", "value": f"{d['solar_kwh']:.2f} kWh/m²/day", "source": "NASA POWER"},
                {"label": "Output", "value": f"{d['annual_mwh'] / 1000:,.0f} GWh/yr", "source": "sun × 365 × MW × 0.8"},
                {"label": "Value per MWh", "value": f"${d['value_per_mwh']:.0f}", "source": "fuel saved × export price"},
                {"label": "Cost of money", "value": f"{d['discount_rate']:.1%}",
                 "source": f"6% + 2.5% per governance point below Norway ({lat['government_effectiveness']:.2f} vs {nor['government_effectiveness']:.2f}, World Bank)"},
            ],
            "sensitivity": f"{d['sensitivity'][0]['label']}: IRR {d['sensitivity'][0]['irr_at_low']:.1%} to {d['sensitivity'][0]['irr_at_high']:.1%} across its range.",
        },
    }


class RailRequest(PlanRequest):
    origin: str
    destination: str


@app.post("/api/rail")
def rail(req: RailRequest):
    a, _, _, _, share = setup(req)
    split = model.normalize(req.split)
    annual = share * model.revenue_baseline(req.iso3)["avg"] * split[1]
    return {**model.rail(req.iso3, req.origin, req.destination, a, annual), "annual_rail_pool": annual}


# ---------- 5 MEMO ----------

@app.post("/api/memo")
def memo(req: PlanRequest):
    """One-page memo from app state. Every number comes from the model."""
    ov = overview(req.iso3)
    p = plan(req)
    d = deal(req)
    y = p["years"][-1]
    t = ov["tiles"]
    mc = p["monte_carlo"]
    goal_lines = "\n".join(
        f"| {g['label']} | {g['target']} | {p['today'][g['key']]:.0%} | {y[g['key']]:.0%} | {mc['p_goal'][g['key']]:.0%} |"
        for g in p["goals"]
    )
    shock_lines = "\n".join(
        f"| {s['label']} | {s['after']['goal_score']:.0f} | {'yes' if s['after']['fully_funded'] else 'no'} |"
        for s in p["shocks"].values()
    )
    share = p["pool"] / p["base_revenue"] if p["base_revenue"] else 0
    text = f"""# {ov['country'].upper()} — PLAN MEMO
Data as of {ov['data_as_of']}. Illustrative model; not investment advice.

## Situation
- Oil money: {money(t['oil']['value'])}/yr (avg {t['oil']['years'][0]}–{t['oil']['years'][-1]}). {t['oil']['note']}
- No electricity: {t['no_power']['value']:.0f}% of people. Clean electricity: {t['clean']['value']:.2f}%.
- Best sun: {t['sun']['site']}, {t['sun']['value']:.2f} kWh/m²/day.

## Plan
- Invest {share:.0%} of oil money: {money(p['pool'])}/yr. Solar {money(p['split_amounts']['solar'])}, rail {money(p['split_amounts']['rail'])}, savings {money(p['split_amounts']['fund'])}.

## Goals (year 10)
| Goal | Target | Today | Year 10 | Met in oil futures |
|---|---|---|---|---|
{goal_lines}

## Flagship project
- {d['mw']:.0f} MW solar at {d['site']}: {money(d['capex'])} to build, IRR {d['irr']:.1%}, payback {d['payback']:.1f} yrs, NPV {money(d['npv'])}.

## Stress test
| Shock | Goal score (yr 10) | Fully funded |
|---|---|---|
| Base case | {y['goal_score']:.0f} | {'yes' if p['shocks']['oil_price']['before']['fully_funded'] else 'no'} |
{shock_lines}

Fully funded in {mc['p_funded']:.0%} of {mc['runs']} oil futures.

## Not modelled
Grid storage, currency risk, rail benefits, household impact of subsidy reform.
"""
    return {"markdown": text}


# ---------- Analyst Q&A (Gemini) ----------

class AdvisorRequest(PlanRequest):
    question: str


ADVISOR_PROMPT = """You are a calm, precise infrastructure finance analyst. Answer in under 80 words.
Use ONLY numbers from the DATA. If something is not in the data, say it is not modelled.
Plain English, short sentences. Money rounded, like "$1.7 billion"."""


@app.post("/api/advisor")
async def advisor(req: AdvisorRequest):
    if gemini is None:
        raise HTTPException(503, "GEMINI_API_KEY missing. Add it to backend/.env")
    contents = [f"DATA:\n{memo(req)['markdown']}\n\nQUESTION: {req.question}"]

    async def stream():
        last_error = None
        for name in [GEMINI_MODEL, GEMINI_MODEL, GEMINI_FALLBACK_MODEL]:
            started = False
            try:
                async for chunk in await gemini.aio.models.generate_content_stream(
                    model=name, contents=contents,
                    config=types.GenerateContentConfig(system_instruction=ADVISOR_PROMPT),
                ):
                    if chunk.text:
                        started = True
                        yield chunk.text
                return
            except Exception as e:
                if started:
                    yield "\n\n(Connection dropped. Try again.)"
                    return
                last_error = e
                await asyncio.sleep(1)
        yield f"Analyst unavailable, try again. ({last_error})"

    return StreamingResponse(stream(), media_type="text/plain; charset=utf-8")
