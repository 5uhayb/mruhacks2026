"""Shared country data: World Bank panel (latest values with their years), resource income and its history,
and finance helpers. The planning model itself lives in electric.py; the earlier four-sector plan is archived in
archive/four-sector/."""

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
YEARS = 10
DEFAULT_HOUSEHOLD_SIZE = 4.5  # used where a country's region has no regional average

# Approximate average people per household by World Bank region (rounded from UN household-size data).
# Planning defaults, editable in the app, not measurements of any one country.
HOUSEHOLD_SIZE_BY_REGION = {
    "Middle East & North Africa": 5.0,
    "Sub-Saharan Africa": 4.8,
    "South Asia": 4.8,
    "Latin America & Caribbean": 3.4,
    "East Asia & Pacific": 3.5,
    "Europe & Central Asia": 2.5,
    "North America": 2.5,
}



@lru_cache(maxsize=None)
def default_household_size(iso3: str) -> float:
    meta = pd.read_csv(DATA / "country_meta.csv").set_index("iso3")
    region = meta.region.get(iso3)
    return HOUSEHOLD_SIZE_BY_REGION.get(region, DEFAULT_HOUSEHOLD_SIZE)



@lru_cache
def load() -> pd.DataFrame:
    """Every country's World Bank panel, unfilled (each value keeps its true year)."""
    return pd.read_csv(DATA / "panel_raw.csv").sort_values(["iso3", "year"])



@lru_cache
def extras():
    governance = pd.read_csv(DATA / "countries.csv")[["iso3", "year", "government_effectiveness", "group"]]
    solar = pd.read_csv(DATA / "country_solar.csv")
    return governance, solar



@lru_cache(maxsize=None)
def country_rows(iso3: str) -> pd.DataFrame:
    """One country's rows (cached; treat as read-only)."""
    panel = load()
    return panel[panel.iso3 == iso3]



def known(iso3: str) -> bool:
    panel = load()
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

