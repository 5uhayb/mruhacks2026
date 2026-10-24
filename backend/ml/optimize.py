"""Find the best plan: search budget splits (power / transport / tourism & industry / savings) at the chosen
investment level for a priority preset, while staying fully funded in at least 80% of futures."""

from itertools import combinations

import numpy as np

import model

MIN_FUNDED = 0.8
MIN_BUILD = 0.2  # a plan with almost nothing built is trivially "funded" but does nothing
OBJECTIVES = ["power", "mobility", "growth", "resilience"]

# Weight on each objective (each scaled 0-1 across the candidate splits). Small weights break ties.
PRESETS = {
    "balanced": {"label": "Balanced", "weights": {"power": 1, "mobility": 1, "growth": 1, "resilience": 1}, "min_each": 0.10},
    "power": {"label": "Power", "weights": {"power": 1, "mobility": 0.02, "growth": 0.02, "resilience": 0.02}, "min_each": 0.0},
    "mobility": {"label": "Mobility", "weights": {"power": 0.02, "mobility": 1, "growth": 0.02, "resilience": 0.02}, "min_each": 0.0},
    "growth": {"label": "Growth", "weights": {"power": 0.02, "mobility": 0.02, "growth": 1, "resilience": 0.02}, "min_each": 0.0},
    "resilience": {"label": "Resilience", "weights": {"power": 0.02, "mobility": 0.02, "growth": 0.02, "resilience": 1}, "min_each": 0.0},
}


def simplex(step: float, around: np.ndarray | None = None, radius: float = 0.0, dims: int = len(model.SECTORS)) -> list[np.ndarray]:
    """Every split of 100% into `dims` parts in multiples of `step` (optionally only those near `around`)."""
    k = round(1 / step)
    pts = []
    for cuts in combinations(range(k + dims - 1), dims - 1):  # stars and bars
        parts = np.diff([-1, *cuts, k + dims - 1]) - 1
        p = parts * step
        if around is None or np.abs(p - around).max() <= radius + 1e-9:
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
    }


def best_plan(ctx: dict, a: dict, share: float, kwh: float, futures: np.ndarray, preset: str = "power",
              supply: str = "import") -> dict:
    spec = PRESETS[preset]
    ok_split = lambda s: s[:model.PROJECTS].sum() >= MIN_BUILD - 1e-9 and s.min() >= spec["min_each"] - 1e-9  # noqa: E731
    coarse = [raw_scores(ctx, a, share, s, kwh, futures, supply) for s in simplex(0.05) if ok_split(s)]
    # Scale each objective 0-1 over the coarse grid so the weights are comparable
    span = {o: (min(c[o] for c in coarse), max(c[o] for c in coarse)) for o in OBJECTIVES}
    objective = lambda c: sum(w * (c[o] - span[o][0]) / ((span[o][1] - span[o][0]) or 1) for o, w in spec["weights"].items())  # noqa: E731

    feasible = [c for c in coarse if c["p_funded"] >= MIN_FUNDED]
    rank = objective if feasible else (lambda c: c["p_funded"])
    pick = max(feasible or coarse, key=rank)
    fine = [raw_scores(ctx, a, share, s, kwh, futures, supply) for s in simplex(0.01, pick["split"], 0.03) if ok_split(s)]
    fine_ok = [c for c in fine if c["p_funded"] >= MIN_FUNDED] if feasible else fine
    best = max(fine_ok or [pick], key=rank)
    return {
        "split": dict(zip(model.SECTORS, (round(float(x) * 100) for x in best["split"]))),
        "p_funded": best["p_funded"], "access_y10": best["access_y10"],
        "feasible": bool(feasible), "plans_tested": len(coarse) + len(fine), "min_funded": MIN_FUNDED,
        "preset": preset, "preset_label": spec["label"],
    }
