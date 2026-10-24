"""Nahda backend. Run with: uvicorn main:app --reload --port 8000"""

import asyncio
import json
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
        "rail_types": model.RAIL_TYPES,
    }


# ---------- 1 OVERVIEW ----------

METRICS = [
    ("electricity_access_pct", "Electricity access", "%", True),
    ("renewable_electricity_pct", "Renewable electricity output", "%", True),
    ("oil_rents_pct_gdp", "Oil rents", "% GDP", False),
    ("gdp_per_capita_usd", "GDP per capita", "$", True),
]


def metric_block(iso3: str, key: str, label: str, unit: str, higher_is_better: bool, note: str) -> dict:
    lat, nor = model.latest(iso3), model.latest("NOR")
    value, ref = lat[key], nor[key]
    compare = None
    if value is not None and ref is not None:
        if unit == "$":
            diff, diff_unit = (value / ref - 1) * 100, "%"
        else:
            diff, diff_unit = value - ref, " pts" if unit.startswith("%") else ""
        compare = {"diff": diff, "unit": diff_unit, "good": (diff >= 0) == higher_is_better, "vs": "NOR"}
    name, code = model.INDICATOR_META[key]
    return {
        "key": key, "label": label, "value": value, "unit": unit, "year": lat[f"{key}_year"],
        "sparkline": model.series(iso3, key, 15), "compare": compare, "note": note,
        "source": f"{name} — {code}",
    }


@app.get("/api/overview/{iso3}")
def overview(iso3: str):
    check_country(iso3)
    a = model.params()
    lat = model.latest(iso3)
    rb = model.revenue_baseline(iso3)
    best = model.sites_for(iso3).iloc[0]

    metrics = [metric_block(iso3, k, label, unit, hib, notes.METRIC_NOTES[k](iso3)) for k, label, unit, hib in METRICS]
    ge = metric_block(iso3, "government_effectiveness", "Government effectiveness", "", True, notes.governance(iso3, a))
    metrics.append(ge)

    benchmark_solar = [
        {"iso3": b, "country": model.latest(b)["country"], "site": s.site, "solar": float(s.solar_kwh_m2_day)}
        for b in model.BENCHMARKS for s in [model.sites_for(b).iloc[0]]
    ]
    used_years = [y for k in ["electricity_access_pct", "renewable_electricity_pct", "gdp_per_capita_usd"]
                  if (y := lat[f"{k}_year"])] + rb["years"]
    return {
        "iso3": iso3, "country": lat["country"],
        "data_as_of": max(used_years),
        "population": lat["population"], "population_year": lat["population_year"],
        "metrics": metrics,
        "revenue": {
            "avg": rb["avg"], "years": rb["years"], "per_person": rb["avg"] / lat["population"],
            "history": rb["history"], "worst": rb["worst"], "best": rb["best"],
            "note": notes.revenue(iso3), "read": notes.read_revenue(iso3),
            "why": {
                "words": f"Resource revenue each year is GDP times the share of GDP that comes from oil rents. "
                         f"The figure is the average of the latest 5 years with data ({rb['years'][0]}–{rb['years'][-1]}). "
                         "Oil rents are oil profits to the whole economy, not the government's budget.",
                "symbols": "R̄ = (1/5) · Σ GDPₜ × rentsₜ",
                "inputs": [
                    {"label": str(r["year"]), "value": f"{money(r['gdp_usd'])} × {r['oil_rents_pct']:.1f}% = {money(r['revenue'])}",
                     "source": "World Bank NY.GDP.MKTP.CD × NY.GDP.PETR.RT.ZS"} for r in rb["used"]
                ],
                "sensitivity": f"The choice of years moves this most: the latest year alone gives {money(rb['used'][-1]['revenue'])}; "
                               f"the worst of the last 10 years gives {money(rb['worst']['revenue'])} ({rb['worst']['year']}).",
            },
        },
        "energy": {
            "access": {c: model.series(c, "electricity_access_pct", 25) for c in [iso3, *model.BENCHMARKS]},
            "read": notes.read_energy(iso3),
        },
        "potential": {
            "best_site": best.site, "best_solar": float(best.solar_kwh_m2_day),
            "benchmarks": benchmark_solar, "note": notes.potential(iso3, a), "read": notes.read_potential(iso3),
            "source": model.SOLAR_SOURCE,
        },
        "peers": model.peers(),
        "peers_read": notes.read_peers(iso3),
        "untapped_formula": "Untapped = 100 × mean( sun, money, gap ). sun = (best kWh/m²/day − 3) / 4, capped 0–1. "
                            "money = revenue per person / $2,000, capped at 1. gap = 1 − renewable electricity share.",
        "read": notes.read_overview(iso3),
        "sites": [
            {"site": s.site, "lat": float(s.lat), "lon": float(s.lon), "solar": float(s.solar_kwh_m2_day),
             "wind": float(s.wind_50m_ms)} for s in model.sites_for(iso3).itertuples()
        ],
    }


# ---------- 2 ALLOCATE + 4 STRESS ----------

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
    return a, model.context(req.iso3), site, kwh, max(0.0, min(req.share, 0.3))


def year10(result: dict, i: int = 0) -> dict:
    last = model.rows(result, i)[-1]
    last["shortfall_total"] = float(result["shortfall"][i].sum())
    last["fully_funded"] = bool(result["fully_funded"][i])
    return last


@app.post("/api/plan")
def plan(req: PlanRequest):
    a, ctx, site, kwh, share = setup(req)
    split = model.normalize(req.split)
    ones = np.ones((1, model.YEARS))
    base = model.simulate(ctx, a, share, split, kwh, ones)
    rows = model.rows(base)
    pool = share * ctx["base_revenue"]

    # Shocks: before vs after, including the flagship solar farm's NPV
    before = year10(base)
    before["deal_npv"] = model.deal(req.iso3, site, req.mw, a)["npv"]
    shocks = {}
    for name, spec in model.SHOCKS.items():
        si = model.shock_inputs(name)
        after = year10(model.simulate(ctx, a, share, split, kwh, si["rev_factor"], si["fuel_mult"], si["capex_mult"]))
        after["deal_npv"] = model.deal(req.iso3, site, req.mw, a, si["capex_mult"], float(si["fuel_mult"][0, 0]), si["rate_shift"])["npv"]
        shocks[name] = {**spec, "before": before, "after": after, "note": notes.shock(name, before, after, req.iso3)}

    # Monte Carlo: 500 oil futures
    ratios = model.oil_scenarios(500)
    mc = model.simulate(ctx, a, share, split, kwh, ratios, ratios)
    p_funded = float(mc["fully_funded"].mean())
    homes_p10 = float(np.percentile(mc["homes"][:, -1], 10))
    fund_p10 = float(np.percentile(mc["fund"][:, -1], 10))

    def p_funded_with_fund(delta):
        s = split.copy()
        s[2] = max(0.0, s[2] + delta)
        return float(model.simulate(ctx, a, share, s, kwh, ratios, ratios)["fully_funded"].mean())

    today = model.resilience_today(ctx)
    y10 = {k: rows[-1][k] for k in [*notes.TERM_LABELS, "resilience"]}
    brent = model.annual_brent()
    return {
        "site": site,
        "readout": {
            "pool": pool, "per_person": pool / ctx["population"], "share": share,
            "base_revenue": ctx["base_revenue"],
            "split_amounts": dict(zip(model.SECTORS, (pool * split).tolist())),
            "note": notes.allocation(share, pool, ctx["population"], ctx["base_revenue"]),
        },
        "years": rows,
        "value_note": notes.value_chart(rows),
        "resilience": {
            "today": today, "year10": y10, "note": notes.resilience(today, y10),
            "why": {
                "words": "Average of four terms, each scaled 0 to 1: savings buffer (fund ÷ one year of resource revenue), "
                         "new non-oil income (solar value + fund returns ÷ 25% of resource revenue), clean power "
                         "(renewable share ÷ 50%), and grid access (share of people connected).",
                "symbols": "FRS = 100 × ¼ (min(1, F/R̄) + min(1, I/0.25R̄) + min(1, ren/50) + access/100)",
                "inputs": [{"label": notes.TERM_LABELS[k], "value": f"{today[k]:.2f} today → {y10[k]:.2f} year 10",
                            "source": "model output"} for k in notes.TERM_LABELS],
                "sensitivity": "The fund share moves this most, through the savings buffer. Existing sovereign "
                               "assets are not modelled; the buffer counts only the new fund.",
            },
        },
        "shocks": shocks,
        "monte_carlo": {
            "runs": len(ratios), "p_funded": p_funded, "homes_p10": homes_p10, "fund_p10": fund_p10,
            "bands": {k: model.percentile_bands(mc[k]) for k in ["pool", "fund", "homes", "resilience"]},
            "note": notes.monte_carlo(p_funded, homes_p10, fund_p10),
            "why": {
                "words": f"500 oil-price futures, built by replaying real yearly Brent changes from {brent.index[1]}–{brent.index[-1]} "
                         f"and pulling prices 30% back toward the 20-year median (${brent.tail(20).median():.0f}/bbl) each year. "
                         "Revenue and fuel value scale with the oil price. A future counts as fully funded when every year's "
                         "solar and rail commitment is met from revenue or by drawing on the fund.",
                "symbols": "P(funded) = share of runs where Σₜ shortfallₜ = 0",
                "inputs": [
                    {"label": "Oil price history", "value": f"{len(brent)} full years", "source": "FRED MCOILBRENTEU"},
                    {"label": "Starting price", "value": f"${model.current_brent():.0f}/bbl (last 12 months)", "source": "FRED"},
                    {"label": "Yearly commitment", "value": money(pool * (split[0] + split[1])), "source": "model"},
                ],
                "sensitivity": f"The fund share moves this most: 10 points less gives {p_funded_with_fund(-0.1):.0%}, "
                               f"10 points more gives {p_funded_with_fund(0.1):.0%}.",
            },
        },
        "rail_pool": pool * split[1],
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
    top = d["sensitivity"][0]
    return {
        **d,
        "notes": notes.deal_notes(d, a),
        "why": {
            "words": "IRR is the yearly return at which the farm's lifetime cash flows net to zero. Each year's cash flow is "
                     "the fuel it frees for export (MWh × fuel per MWh × export value) minus running costs. Payback is "
                     "the number of years until cumulative cash covers the build cost. NPV discounts the cash flows at "
                     "the country's cost of capital.",
            "symbols": "0 = −CAPEX + Σₜ (MWh·(1−deg)ᵗ · HR · P − O&M) / (1+IRR)ᵗ",
            "inputs": [
                {"label": "Sunlight", "value": f"{d['solar_kwh']:.2f} kWh/m²/day", "source": model.SOLAR_SOURCE},
                {"label": "Annual output", "value": f"{d['annual_mwh'] / 1000:,.0f} GWh", "source": "sunlight × 365 × MW × performance ratio"},
                {"label": "CAPEX", "value": money(d["capex"]), "source": "assumption"},
                {"label": "Value per MWh", "value": f"${d['value_per_mwh']:.0f}", "source": "heat rate × fuel export value"},
                {"label": "Cost of capital", "value": f"{d['discount_rate']:.1%}",
                 "source": f"{a['base_discount_rate']:.1%} + {a['risk_premium_per_point']:.1%} × (NOR {nor['government_effectiveness']:.2f} − "
                           f"({lat['government_effectiveness']:.2f})), World Bank WGI government effectiveness"},
            ],
            "sensitivity": f"{top['label']} moves the IRR most: {top['irr_at_low']:.1%} at the low end of its range, "
                           f"{top['irr_at_high']:.1%} at the high end.",
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
    return {**model.rail(req.iso3, req.origin, req.destination, a, annual), "annual_rail_pool": annual,
            "note": "Cost and funding timeline only — benefits are not modelled."}


# ---------- 5 MEMO ----------

@app.post("/api/memo")
def memo(req: PlanRequest):
    """One-page memo from app state. A Python template: every number comes from the model."""
    ov = overview(req.iso3)
    p = plan(req)
    d = deal(req)
    r = p["readout"]
    y = p["years"][-1]
    mc = p["monte_carlo"]
    m = {x["key"]: x for x in ov["metrics"]}
    split = {k: v / r["pool"] if r["pool"] else 0 for k, v in r["split_amounts"].items()}
    shock_lines = "\n".join(
        f"| {s['label']} | {s['after']['homes']:,.0f} | {money(s['after']['fund'])} | "
        f"{s['after']['resilience']:.0f} | {'yes' if s['after']['fully_funded'] else 'no'} |"
        for s in p["shocks"].values()
    )
    text = f"""# {ov['country'].upper()} — CAPITAL PLAN MEMO
Data as of {ov['data_as_of']}. Illustrative planning model; not investment advice.

## 1. Situation
- Resource revenue: {money(ov['revenue']['avg'])}/yr (avg {ov['revenue']['years'][0]}–{ov['revenue']['years'][-1]}), ${ov['revenue']['per_person']:,.0f} per person.
- Range in the last 10 years: {money(ov['revenue']['worst']['revenue'])} ({ov['revenue']['worst']['year']}) to {money(ov['revenue']['best']['revenue'])} ({ov['revenue']['best']['year']}).
- Electricity access: {m['electricity_access_pct']['value']:.1f}% ({m['electricity_access_pct']['year']}). Renewable electricity: {m['renewable_electricity_pct']['value']:.2f}% ({m['renewable_electricity_pct']['year']}).
- Best solar site: {ov['potential']['best_site']}, {ov['potential']['best_solar']:.2f} kWh/m²/day.

## 2. Capital sources and uses
- Source: {r['share']:.0%} of resource revenue = {money(r['pool'])}/yr (${r['per_person']:,.0f} per person).
- Uses: solar {split['solar']:.0%} ({money(r['split_amounts']['solar'])}/yr), rail {split['rail']:.0%} ({money(r['split_amounts']['rail'])}/yr), savings fund {split['fund']:.0%} ({money(r['split_amounts']['fund'])}/yr).
- Year 10: {y['solar_mw']:,.0f} MW solar ({y['homes']:,.0f} home-equivalents of power, {y['renewable_pct']:.0f}% of electricity renewable), {y['rail_km']:,.0f} km rail, fund {money(y['fund'])}.

## 3. Projects and returns
- Flagship: {d['mw']:.0f} MW at {d['site']}. CAPEX {money(d['capex'])}, {d['annual_mwh'] / 1000:,.0f} GWh/yr.
- IRR {d['irr']:.1%} (range {d['irr_low']:.1%}–{d['irr_high']:.1%}); NPV {money(d['npv'])} at {d['discount_rate']:.1%}; payback {d['payback']:.1f} years.
- Same farm at Norway's cost of capital ({d['nor_discount_rate']:.1%}): NPV {money(d['npv_at_nor_rate'])}.
- Rail: cost and funding timeline only; benefits not modelled.

## 4. Stress results
| Shock | Home-equivalents (yr 10) | Fund (yr 10) | Resilience | Fully funded |
|---|---|---|---|---|
| Base case | {y['homes']:,.0f} | {money(y['fund'])} | {y['resilience']:.0f} | {'yes' if p['shocks']['oil_price']['before']['fully_funded'] else 'no'} |
{shock_lines}

Monte Carlo ({mc['runs']} runs): fully funded in {mc['p_funded']:.0%} of futures. P10: {mc['homes_p10']:,.0f} home-equivalents, fund {money(mc['fund_p10'])}.
Fiscal Resilience Score: {p['resilience']['today']['resilience']:.0f} today → {p['resilience']['year10']['resilience']:.0f} in year 10.

## 5. Key risks
- Transmission and storage: grid upgrades and storage for solar beyond daytime demand are not modelled.
- Currency (FX): revenue is in dollars; local construction costs and wages are not modelled.
- Governance: government effectiveness score {m['government_effectiveness']['value']:.2f} (World Bank, {m['government_effectiveness']['year']}); this sets the {d['discount_rate']:.1%} cost of capital.
- Household impact of subsidy reform: not modelled.
- Oil price: see stress results; shortfalls occur when prices fall before the fund has grown.

## 6. Phased roadmap
- Years 1–2: set up the fund and its rules; procure the first solar capacity at {d['site']}; route studies for rail.
- Years 3–5: solar output starts replacing fuel burn; first rail segments open (build time {model.params(req.assumptions)['rail_build_years']:.0f} years in the model).
- Years 6–10: scale solar toward {y['solar_mw']:,.0f} MW; fund reaches {money(y['fund'])} and covers revenue shortfalls.
"""
    return {"markdown": text}


# ---------- Analyst Q&A (Gemini) ----------

class AdvisorRequest(PlanRequest):
    question: str


ADVISOR_PROMPT = """You are a calm, precise infrastructure finance analyst. Answer in under 120 words.
Use ONLY numbers from the DATA. If something is not in the data, say it is not modelled.
No hype words. Plain English. Money rounded, like "$1.7 billion"."""


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
