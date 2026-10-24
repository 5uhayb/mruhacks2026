"""Find the best plan: search budget splits (solar / rail / savings) at the chosen investment level to
reach electricity access as fast as possible, while staying fully funded in at least 80% of futures."""

import numpy as np

import model

MIN_FUNDED = 0.8


def simplex(step: float, around: np.ndarray | None = None, radius: float = 0.0) -> list[np.ndarray]:
    k = round(1 / step)
    pts = []
    for i in range(k + 1):
        for j in range(k + 1 - i):
            p = np.array([i, j, k - i - j]) * step
            if around is None or np.abs(p - around).max() <= radius + 1e-9:
                pts.append(p)
    return pts


def score(ctx: dict, a: dict, share: float, split: np.ndarray, kwh: float, futures: np.ndarray) -> dict:
    r = model.simulate(ctx, a, share, split, kwh, futures)
    return {
        "split": split,
        "p_funded": float(r["fully_funded"].mean()),
        # Average access over the 10 years rewards getting there sooner; clean power breaks ties
        "objective": float(r["access_pct"].mean() + 0.01 * r["renewable_pct"][:, -1].mean()),
        "access_y10": float(np.median(r["access_pct"][:, -1])),
    }


def best_plan(ctx: dict, a: dict, share: float, kwh: float, futures: np.ndarray) -> dict:
    # A plan with no solar or rail is trivially "funded" but does nothing; require some building
    coarse = [score(ctx, a, share, s, kwh, futures) for s in simplex(0.05) if s[0] + s[1] >= 0.2]
    feasible = [c for c in coarse if c["p_funded"] >= MIN_FUNDED]
    pick = max(feasible, key=lambda c: c["objective"]) if feasible else max(coarse, key=lambda c: c["p_funded"])
    fine = [score(ctx, a, share, s, kwh, futures) for s in simplex(0.01, pick["split"], 0.05) if s[0] + s[1] >= 0.2]
    fine_ok = [c for c in fine if c["p_funded"] >= MIN_FUNDED] if feasible else fine
    best = max(fine_ok, key=(lambda c: c["objective"]) if feasible else (lambda c: c["p_funded"]))
    return {
        "split": dict(zip(model.SECTORS, (round(float(x) * 100) for x in best["split"]))),
        "p_funded": best["p_funded"], "access_y10": best["access_y10"],
        "feasible": bool(feasible), "plans_tested": len(coarse) + len(fine), "min_funded": MIN_FUNDED,
    }
