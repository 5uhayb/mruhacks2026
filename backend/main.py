"""Nahda backend. Run with: uvicorn main:app --reload --port 8000"""

import asyncio
import json
import os
from datetime import datetime

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from pydantic import BaseModel

import model

load_dotenv()  # API keys from backend/.env

GEMINI_MODEL = "gemini-flash-lite-latest"
GEMINI_FALLBACK_MODEL = "gemini-flash-latest"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Server still starts without a key; only the advisor needs it
gemini = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

app = FastAPI(title="Nahda API")

# Allow the Vite dev server to call the API directly too
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def clean(records):
    """Replace NaN with None so it serializes to JSON null."""
    return json.loads(pd.DataFrame(records).to_json(orient="records"))


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


@app.get("/api/countries")
def countries():
    df, _, _ = model.load()
    rows = df[["iso3", "country", "group"]].drop_duplicates().sort_values("country")
    return rows.to_dict(orient="records")


@app.get("/api/country/{iso3}")
def country(iso3: str):
    df, sites, _ = model.load()
    if iso3 not in set(df.iso3):
        raise HTTPException(404, f"Unknown country {iso3}")
    history = df[df.iso3.isin([iso3, *model.BENCHMARKS])][
        ["iso3", "year", "gdp_per_capita_usd", "electricity_access_pct", "oil_rents_pct_gdp"]
    ]
    return {
        "latest": model.latest(iso3),
        "benchmarks": [model.latest(b) for b in model.BENCHMARKS],
        "history": clean(history),
        "sites": clean(sites[sites.iso3 == iso3].sort_values("score", ascending=False)),
        "current_brent": model.current_brent(),
        "assumptions": model.ASSUMPTIONS,
    }


class PlanRequest(BaseModel):
    iso3: str
    invest_share: float  # share of oil revenue redirected, 0-1
    split: dict[str, float]  # solar / rail / education / fund weights
    oil_price: float
    site: str | None = None


def setup(req: PlanRequest):
    _, sites, _ = model.load()
    country_sites = sites[sites.iso3 == req.iso3]
    if req.site and req.site in set(country_sites.site):
        chosen = country_sites[country_sites.site == req.site].iloc[0]
    else:
        chosen = country_sites.sort_values("score").iloc[-1]
    split = np.array([req.split.get(s, 0) for s in model.SECTORS], dtype=float)
    return model.profile(req.iso3), split, float(chosen.solar_kwh_m2_day), chosen.site


@app.post("/api/project")
def project(req: PlanRequest):
    p, split, solar_kwh, site = setup(req)
    prices = np.full((1, model.YEARS), req.oil_price)
    return {"site": site, "years": model.to_rows(model.simulate(p, req.invest_share, split, prices, solar_kwh))}


@app.post("/api/stress")
def stress(req: PlanRequest):
    p, split, solar_kwh, _ = setup(req)
    prices = model.oil_scenarios(req.oil_price)
    result = model.simulate(p, req.invest_share, split, prices, solar_kwh)
    final_score = result["score"][:, -1]
    return {
        "scenarios": len(prices),
        "bands": model.percentiles(result),
        "oil_price": [
            {"year": t + 1, **dict(zip(["p10", "p50", "p90"], np.percentile(prices[:, t], [10, 50, 90])))}
            for t in range(model.YEARS)
        ],
        "crash_share": float((prices.min(axis=1) < 40).mean()),
        "score_p10": float(np.percentile(final_score, 10)),
        "score_p50": float(np.percentile(final_score, 50)),
    }


@app.post("/api/optimize")
def optimize(req: PlanRequest):
    p, split, solar_kwh, _ = setup(req)
    prices = model.oil_scenarios(req.oil_price, n=200)
    return model.optimize(p, req.invest_share, prices, solar_kwh, split)


class AdvisorRequest(PlanRequest):
    question: str | None = None  # empty = write the full plan


ADVISOR_PROMPT = """You are an economic development advisor helping a resource-rich country
turn oil revenue into lasting prosperity. Use ONLY the numbers provided; do not invent statistics.
Be specific, practical, and honest about risks (governance, corruption, conflict, oil volatility).
Reference real precedents where relevant: Norway's Government Pension Fund Global, the UAE's
diversification, Botswana's diamond revenue management. Use short markdown headings and bullets.
Money values in the data are in US dollars: write them rounded, like "$6.0 billion" or "$750 million".
Round other numbers sensibly (1,005 km, 77%)."""


@app.post("/api/advisor")
async def advisor(req: AdvisorRequest):
    if gemini is None:
        raise HTTPException(503, "GEMINI_API_KEY missing. Add it to backend/.env")
    p, split, solar_kwh, site = setup(req)
    prices = np.full((1, model.YEARS), req.oil_price)
    final = model.to_rows(model.simulate(p, req.invest_share, split, prices, solar_kwh))[-1]
    facts = {
        "country": model.latest(req.iso3),
        "plan": {
            "share_of_oil_revenue_invested": req.invest_share,
            "split": dict(zip(model.SECTORS, (split / split.sum()).round(3).tolist())),
            "oil_price_assumption_usd": req.oil_price,
            "solar_site": site,
        },
        "projected_year_10": final,
        "benchmarks": [model.latest(b) for b in model.BENCHMARKS],
        "assumptions": model.ASSUMPTIONS,
    }
    task = (
        f"Answer this question about the plan in under 150 words: {req.question}"
        if req.question
        else "Write a phased 10-year revitalization plan (Years 1-2, 3-5, 6-10) in under 300 words, "
        "then 3 key risks with mitigations, then one line on which country precedent fits best."
    )
    contents = [f"DATA:\n{json.dumps(facts, default=str)}\n\nTASK: {task}"]

    async def stream():
        # Lite answers in ~2s; the full model can take over a minute under load
        last_error = None
        for name in [GEMINI_MODEL, GEMINI_MODEL, GEMINI_FALLBACK_MODEL]:
            started = False
            try:
                async for chunk in await gemini.aio.models.generate_content_stream(
                    model=name,
                    contents=contents,
                    config=types.GenerateContentConfig(system_instruction=ADVISOR_PROMPT),
                ):
                    if chunk.text:
                        started = True
                        yield chunk.text
                return
            except Exception as e:
                if started:
                    yield "\n\n_(Connection to the advisor dropped. Try again.)_"
                    return
                last_error = e
                await asyncio.sleep(1)
        yield f"Gemini is busy, try again. ({last_error})"

    return StreamingResponse(stream(), media_type="text/plain; charset=utf-8")
