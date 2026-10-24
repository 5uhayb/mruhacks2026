"""Comeback Finder: other countries that were once where this country is now, and what happened next.

A country's last 5 years are compared with every 5-year stretch in other countries' histories, using
dynamic time warping (DTW) on standardized features. The closest 3 countries are its "twins"."""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"
WINDOW = 5
HORIZON = 10

FEATURES = ["electricity_access_pct", "oil_rents_pct_gdp", "log_gdp_per_capita", "renewable_electricity_pct", "urban_pct"]


def load_panel() -> pd.DataFrame:
    p = pd.read_csv(DATA / "panel.csv").sort_values(["iso3", "year"])
    p["log_gdp_per_capita"] = np.log10(p.gdp_per_capita_usd)
    return p


def dtw_batch(target: np.ndarray, windows: np.ndarray) -> np.ndarray:
    """DTW distance from one (time, features) sequence to N windows of shape (N, time, features), vectorized."""
    cost = np.linalg.norm(target[None, :, None, :] - windows[:, None, :, :], axis=3)  # (N, T, T)
    n, t, _ = cost.shape
    acc = np.full((n, t + 1, t + 1), np.inf)
    acc[:, 0, 0] = 0.0
    for i in range(1, t + 1):
        for j in range(1, t + 1):
            acc[:, i, j] = cost[:, i - 1, j - 1] + np.minimum(np.minimum(acc[:, i - 1, j], acc[:, i, j - 1]), acc[:, i - 1, j - 1])
    return acc[:, t, t]


@dataclass
class TwinIndex:
    """Every 5-year window (in any country) that has a measured outcome 10 years later."""
    panel: pd.DataFrame
    stats: dict
    windows: np.ndarray  # (N, WINDOW, features), standardized
    iso3: np.ndarray
    end: np.ndarray

    @classmethod
    def build(cls, panel: pd.DataFrame) -> "TwinIndex":
        stats = {f: (float(panel[f].mean()), float(panel[f].std())) for f in FEATURES}
        z = np.column_stack([(panel[f] - stats[f][0]) / stats[f][1] for f in FEATURES])
        wins, isos, ends = [], [], []
        for iso3, idx in panel.groupby("iso3").indices.items():
            g = panel.iloc[idx]
            years = g.year.to_numpy()
            observed = set(years[g.access_observed.to_numpy()])
            all_years = set(years)
            for k in range(WINDOW - 1, len(years)):
                e = years[k]
                if years[k] - years[k - WINDOW + 1] != WINDOW - 1 or e not in observed or e + HORIZON not in observed:
                    continue
                if not all(y in all_years for y in range(e, e + HORIZON + 1)):
                    continue
                wins.append(z[idx[k - WINDOW + 1 : k + 1]])
                isos.append(iso3)
                ends.append(e)
        return cls(panel, stats, np.array(wins), np.array(isos), np.array(ends))

    def standardized(self, rows: pd.DataFrame) -> np.ndarray:
        return np.column_stack([(rows[f] - self.stats[f][0]) / self.stats[f][1] for f in FEATURES])

    def find(self, iso3: str, k: int = 3) -> dict | None:
        g = self.panel[self.panel.iso3 == iso3]
        if g.empty or not g.access_observed.any():
            return None
        end = int(g.year[g.access_observed].max())  # latest year with measured electricity access
        recent = g[(g.year > end - WINDOW) & (g.year <= end)]
        if len(recent) < WINDOW:
            return None
        mask = self.iso3 != iso3
        d = dtw_batch(self.standardized(recent), self.windows[mask])
        isos, ends = self.iso3[mask], self.end[mask]

        # Best window per other country, so the twins are 3 different countries
        best = pd.DataFrame({"iso3": isos, "end": ends, "d": d}).sort_values("d").drop_duplicates("iso3")
        scale = float(best.d.median())  # similarity: 100% = identical; a typical country's best match ≈ 37%

        now = g.set_index("year").loc[end]
        twins = []
        for r in best.head(k).itertuples():
            o = self.panel[self.panel.iso3 == r.iso3].set_index("year")
            path = o.loc[r.end : r.end + HORIZON]
            twins.append({
                "iso3": r.iso3, "country": str(o.country.iloc[0]), "year": int(r.end),
                "similarity": float(100 * np.exp(-r.d / scale)),
                "access_then": float(o.loc[r.end, "electricity_access_pct"]),
                "access": [float(v) for v in path.electricity_access_pct],
                "gdp_per_capita": [float(v) for v in path.gdp_per_capita_usd],
            })

        # Twin forecast: each twin's next-10-year change applied to today, weighted by similarity
        w = np.array([t["similarity"] for t in twins])
        w = w / w.sum()
        acc = np.array([[np.clip(now.electricity_access_pct + a - t["access"][0], 0, 100) for a in t["access"]] for t in twins])
        gdp = np.array([[now.gdp_per_capita_usd * x / t["gdp_per_capita"][0] for x in t["gdp_per_capita"]] for t in twins])
        forecast = [{"year": end + i, "access": float(w @ acc[:, i]), "access_low": float(acc[:, i].min()),
                     "access_high": float(acc[:, i].max()), "gdp": float(w @ gdp[:, i]),
                     "gdp_low": float(gdp[:, i].min()), "gdp_high": float(gdp[:, i].max())} for i in range(HORIZON + 1)]
        return {"year": end, "access_now": float(now.electricity_access_pct), "gdp_now": float(now.gdp_per_capita_usd),
                "twins": twins, "forecast": forecast, "windows_searched": int(mask.sum()), "countries_compared": int(len(best))}
