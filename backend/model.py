"""Nahda simulation: 10-year projections, oil-price stress test, and budget optimizer."""

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
SECTORS = ["solar", "rail", "education", "fund"]
YEARS = 10

# Rough public cost benchmarks. Every number the model uses lives here and is shown in the UI.
ASSUMPTIONS = {
    "solar_cost_per_mw_usd": 750_000,  # utility-scale PV, MENA region
    "solar_performance_ratio": 0.8,  # share of sunlight converted after losses
    "solar_build_years": 1,  # time from funding to a working solar farm
    "rail_build_years": 2,  # time from funding to an open rail line
    "kwh_per_new_person": 1_000,  # yearly electricity for a newly connected person
    "rail_cost_per_km_usd": 15_000_000,  # conventional intercity rail
    "cost_per_youth_job_usd": 25_000,  # training + job placement programs
    "youth_share_of_population": 0.17,  # ages 15-24
    "youth_participation_rate": 0.45,  # youth in the labor force
    "min_youth_unemployment_pct": 8,  # floor: some unemployment always exists
    "fund_real_return": 0.05,  # Norway's fund has averaged about 6% real
}

BENCHMARKS = ["NOR", "ARE", "BWA"]


@lru_cache
def load():
    countries = pd.read_csv(DATA / "countries.csv")
    sites = pd.read_csv(DATA / "sites.csv")
    oil = pd.read_csv(DATA / "oil_prices.csv", parse_dates=["date"])
    sites["score"] = site_score(sites["solar_kwh_m2_day"], sites["wind_50m_ms"])
    return countries, sites, oil


def site_score(solar, wind):
    """0-100: mostly solar quality, some wind quality."""
    solar_n = np.clip((solar - 3) / (7 - 3), 0, 1)
    wind_n = np.clip((wind - 3) / (9 - 3), 0, 1)
    return (100 * (0.7 * solar_n + 0.3 * wind_n)).round(1)


def latest(iso3: str) -> dict:
    countries, _, _ = load()
    df = countries[countries.iso3 == iso3].sort_values("year")
    out = {"iso3": iso3, "country": df.country.iloc[0], "group": df.group.iloc[0]}
    for col in df.columns.drop(["iso3", "country", "group", "year"]):
        s = df[["year", col]].dropna()
        out[col] = None if s.empty else float(s[col].iloc[-1])
        out[f"{col}_year"] = None if s.empty else int(s.year.iloc[-1])
    return out


def annual_brent() -> pd.Series:
    _, _, oil = load()
    by_year = oil.groupby(oil.date.dt.year).brent_usd
    full = by_year.count() == 12
    return by_year.mean()[full]


def current_brent() -> float:
    _, _, oil = load()
    return float(oil.brent_usd.tail(12).mean())


def profile(iso3: str) -> dict:
    """Numbers the simulation needs for one country."""
    p = latest(iso3)
    brent = annual_brent()
    # Oil revenue per $1 of Brent price, from the latest year with oil revenue data
    k = (p["oil_rents_usd"] or 0) / brent.get(p["oil_rents_usd_year"], current_brent())
    return {
        "population": p["population"],
        "access0": p["electricity_access_pct"] or 100.0,
        "youth_u0": p["youth_unemployment_pct"] or 15.0,
        "kwh_per_person": p["kwh_per_person"] or 1_500.0,
        "revenue_per_brent_dollar": k,
    }


def delay(spending: np.ndarray, years: int) -> np.ndarray:
    """Money spent in year t only produces results in year t + years (construction time)."""
    out = np.zeros_like(spending)
    out[:, years:] = spending[:, : YEARS - years]
    return out


def simulate(p: dict, invest_share: float, split: np.ndarray, prices: np.ndarray, solar_kwh: float) -> dict:
    """Run the model. prices has shape (scenarios, YEARS); every output has the same shape."""
    a = ASSUMPTIONS
    split = np.asarray(split, dtype=float)
    split = split / split.sum() if split.sum() > 0 else np.full(4, 0.25)

    revenue = p["revenue_per_brent_dollar"] * prices
    budget = revenue * invest_share
    solar_usd, rail_usd, edu_usd, fund_usd = (budget * s for s in split)

    # Solar: capacity built -> yearly generation -> people connected, then share of national demand
    solar_mw = np.cumsum(delay(solar_usd, a["solar_build_years"]) / a["solar_cost_per_mw_usd"], axis=1)
    solar_mwh = solar_mw * solar_kwh * 365 * a["solar_performance_ratio"]
    pop = p["population"]
    mwh_per_new = a["kwh_per_new_person"] / 1000
    unconnected = pop * (100 - p["access0"]) / 100
    connected = np.minimum(solar_mwh / mwh_per_new, unconnected)
    access = p["access0"] + connected / pop * 100
    demand_mwh = pop * p["kwh_per_person"] / 1000 + unconnected * mwh_per_new
    solar_share = np.minimum(100, solar_mwh / demand_mwh * 100)

    rail_km = np.cumsum(delay(rail_usd, a["rail_build_years"]) / a["rail_cost_per_km_usd"], axis=1)

    jobs = np.cumsum(edu_usd / a["cost_per_youth_job_usd"], axis=1)
    youth_labor = pop * a["youth_share_of_population"] * a["youth_participation_rate"]
    floor = min(a["min_youth_unemployment_pct"], p["youth_u0"])
    youth_u = np.maximum(floor, p["youth_u0"] - jobs / youth_labor * 100)

    fund = np.zeros_like(budget)
    for t in range(YEARS):
        prev = fund[:, t - 1] if t else 0
        fund[:, t] = prev * (1 + a["fund_real_return"]) + fund_usd[:, t]

    return {
        "revenue": revenue,
        "budget": budget,
        "solar_gw": solar_mw / 1000,
        "electricity_access": access,
        "solar_share": solar_share,
        "rail_km": rail_km,
        "youth_jobs": jobs,
        "youth_unemployment": youth_u,
        "fund": fund,
        "score": score(p, access, solar_share, youth_u, rail_km, fund, revenue),
    }


def score(p, access, solar_share, youth_u, rail_km, fund, revenue) -> np.ndarray:
    """0-100 revitalization score: average of four goals, each with diminishing returns."""
    gap = 100 - p["access0"]
    clean = np.minimum(solar_share / 50, 1)
    power = 0.5 * (access - p["access0"]) / gap + 0.5 * clean if gap > 0.5 else clean
    room = p["youth_u0"] - min(ASSUMPTIONS["min_youth_unemployment_pct"], p["youth_u0"])
    youth = (p["youth_u0"] - youth_u) / room if room > 0 else np.ones_like(youth_u)
    transit = 1 - np.exp(-rail_km / 1000)
    # Savings worth 2 years of oil revenue = well protected against a crash
    resilience = 1 - np.exp(-fund / (2 * revenue.mean(axis=1, keepdims=True)))
    return 100 * (power + youth + transit + resilience) / 4


def oil_scenarios(start_price: float, n: int = 1000, seed: int = 42) -> np.ndarray:
    """Replay real yearly Brent shocks (1988-2025), with prices pulled back toward their
    20-year median each year, the way oil markets tend to revert after booms and crashes."""
    brent = annual_brent()
    shocks = np.log(brent).diff().dropna().to_numpy()
    shocks -= shocks.mean()
    long_run = np.log(brent.tail(20).median())
    reversion = 0.3

    rng = np.random.default_rng(seed)
    draws = rng.choice(shocks, size=(n, YEARS))
    log_p = np.empty((n, YEARS))
    prev = np.full(n, np.log(start_price))
    for t in range(YEARS):
        prev = prev + reversion * (long_run - prev) + draws[:, t]
        log_p[:, t] = prev
    return np.exp(log_p)


def to_rows(result: dict, row: int = 0) -> list[dict]:
    return [
        {"year": t + 1, **{k: float(v[row, t]) for k, v in result.items()}}
        for t in range(YEARS)
    ]


def percentiles(result: dict) -> dict:
    out = {}
    for key in ["budget", "electricity_access", "youth_unemployment", "rail_km", "fund", "score"]:
        p10, p50, p90 = np.percentile(result[key], [10, 50, 90], axis=0)
        out[key] = [{"year": t + 1, "p10": p10[t], "p50": p50[t], "p90": p90[t]} for t in range(YEARS)]
    return out


def optimize(p: dict, invest_share: float, prices: np.ndarray, solar_kwh: float, current: np.ndarray) -> dict:
    """Find the split with the best worst-case (10th percentile) score across oil scenarios."""
    rng = np.random.default_rng(7)

    def robust(split):
        final = simulate(p, invest_share, split, prices, solar_kwh)["score"][:, -1]
        return float(np.percentile(final, 10))

    candidates = list(rng.dirichlet(np.ones(4), 1500)) + [current / current.sum()]
    best = max(candidates, key=robust)
    # Refine around the best split found so far
    for _ in range(2):
        nearby = list(rng.dirichlet(best * 60 + 0.5, 300)) + [best]
        best = max(nearby, key=robust)
    return {
        "split": dict(zip(SECTORS, (round(float(x), 3) for x in best))),
        "robust_score": robust(best),
        "current_robust_score": robust(current),
    }
