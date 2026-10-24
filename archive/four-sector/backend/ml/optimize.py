"""Preset splits: one pass over every realistic 4-sector split (each sector 10–50%, 5% steps) scores all
presets at once, so a country's presets are ready in about a second and then served from cache.
Every preset keeps at least 90% of planned spending on track in ≥80% of futures where any split can."""

from itertools import combinations

import numpy as np

import model

MIN_FUNDED = 0.8
LOW, HIGH = 0.10, 0.50  # realistic bounds for a preset; users can still drag past them by hand
OBJECTIVES = ["power", "mobility", "growth", "resilience"]

# Weight on each objective (each scaled 0-1 across the candidate splits). Small weights break ties.
PRESETS = {
    "balanced": {"label": "Balanced", "weights": {"power": 1, "mobility": 1, "growth": 1, "resilience": 1}},
    "power": {"label": "Power", "weights": {"power": 1, "mobility": 0.02, "growth": 0.02, "resilience": 0.02}},
    "mobility": {"label": "Mobility", "weights": {"power": 0.02, "mobility": 1, "growth": 0.02, "resilience": 0.02}},
    "growth": {"label": "Growth", "weights": {"power": 0.02, "mobility": 0.02, "growth": 1, "resilience": 0.02}},
}


def simplex(step: float, dims: int = len(model.SECTORS), low: float = 0.0, high: float = 1.0) -> list[np.ndarray]:
    """Every split of 100% into `dims` parts in multiples of `step`, each part within [low, high]."""
    k = round(1 / step)
    pts = []
    for cuts in combinations(range(k + dims - 1), dims - 1):  # stars and bars
        p = (np.diff([-1, *cuts, k + dims - 1]) - 1) * step
        if p.min() >= low - 1e-9 and p.max() <= high + 1e-9:
            pts.append(p)
    return pts


def raw_scores(ctx: dict, a: dict, share: float, split: np.ndarray, kwh: float, futures: np.ndarray, supply: str) -> dict:
    r = model.simulate(ctx, a, share, split, kwh, futures, supply=supply)
    return {
        "split": split,
        "p_funded": float(r["fully_funded"].mean()),
        # Average access over the 10 years rewards getting there sooner; clean power breaks ties
        "power": float(r["access_pct"].mean() + 0.01 * r["renewable_pct"][:, -1].mean()),
        "mobility": float(np.minimum(1.0, r["rail_km"][:, -1] / ctx["route"]["km"]).mean()),
        # Growth counts new non-oil activity only: solar's return is fuel sold abroad instead of burned, still oil income
        "growth": float((r["rail_value"] + r["industry_value"])[:, -1].mean()),
        "resilience": float(np.minimum(1.0, r["fund"][:, -1] / max(ctx["base_revenue"], 1.0)).mean() + 0.5 * r["fully_funded"].mean()),
        "access_y10": float(np.median(r["access_pct"][:, -1])),
        "clean_y10": float(np.median(r["renewable_pct"][:, -1])),
        "rail_km_y10": float(np.median(r["rail_km"][:, -1])),
    }


def all_presets(ctx: dict, a: dict, share: float, kwh: float, futures: np.ndarray, supply: str = "import") -> dict:
    grid = [raw_scores(ctx, a, share, s, kwh, futures, supply) for s in simplex(0.05, low=LOW, high=HIGH)]
    span = {o: (min(c[o] for c in grid), max(c[o] for c in grid)) for o in OBJECTIVES}
    feasible = [c for c in grid if c["p_funded"] >= MIN_FUNDED]
    out = {}
    for key, spec in PRESETS.items():
        objective = lambda c: sum(w * (c[o] - span[o][0]) / ((span[o][1] - span[o][0]) or 1)  # noqa: E731
                                  for o, w in spec["weights"].items())
        best = max(feasible, key=objective) if feasible else max(grid, key=lambda c: c["p_funded"])
        out[key] = {
            "split": dict(zip(model.SECTORS, (round(float(x) * 100) for x in best["split"]))),
            "p_funded": best["p_funded"], "feasible": bool(feasible), "label": spec["label"],
            "access_y10": best["access_y10"], "clean_y10": best["clean_y10"], "rail_km_y10": best["rail_km_y10"],
        }
    return {"presets": out, "plans_tested": len(grid)}
