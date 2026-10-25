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

FEATURES = ["electricity_access_pct", "oil_rents_pct_gdp", "log_gdp_per_capita", "renewable_electricity_pct", "urban_pct",
            "log_population"]
# Peers for the electrification planner match on electricity instead of oil
ELECTRIC_FEATURES = ["electricity_access_pct", "urban_access_pct", "rural_access_pct", "renewable_electricity_pct",
                     "log_gdp_per_capita", "log_population"]
PEER_BAND = 15  # peers start within 15 points of the country's access
PEER_RULE = ("Peers: countries whose 5-year electricity path (total, urban and rural access, clean share, income, population) "
             "best matches, that started within 15 points of this country's access and below 95%, and then gained at least "
             "10 points (or reached 95%) in the next 10 years.")
MAX_POP_RATIO = 10  # twins must be within one order of magnitude in population


def load_panel() -> pd.DataFrame:
    p = pd.read_csv(DATA / "panel.csv").sort_values(["iso3", "year"])
    p["log_gdp_per_capita"] = np.log10(p.gdp_per_capita_usd)
    p["log_population"] = np.log10(p.population)
    detail = DATA / "electricity.csv"
    if detail.exists():
        p = p.merge(pd.read_csv(detail), on=["iso3", "year"], how="left")
        cols = ["urban_access_pct", "rural_access_pct"]
        p[cols] = p.groupby("iso3")[cols].ffill()
        # Where urban or rural access was never measured, the national figure stands in for both
        for c in cols:
            p[c] = p[c].fillna(p.electricity_access_pct)
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
    log_pop: np.ndarray  # population at the end of each window (log10)
    access_start: np.ndarray  # access at the end of each window
    access_after: np.ndarray  # access 10 years later
    features: list

    @classmethod
    def build(cls, panel: pd.DataFrame, features: list | None = None) -> "TwinIndex":
        features = features or FEATURES
        stats = {f: (float(panel[f].mean()), float(panel[f].std())) for f in features}
        z = np.column_stack([(panel[f] - stats[f][0]) / stats[f][1] for f in features])
        wins, isos, ends, pops, a0, a10 = [], [], [], [], [], []
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
                pops.append(g.log_population.iloc[k])
                acc = g.set_index("year").electricity_access_pct
                a0.append(float(acc.loc[e]))
                a10.append(float(acc.loc[e + HORIZON]))
        return cls(panel, stats, np.array(wins), np.array(isos), np.array(ends), np.array(pops), np.array(a0), np.array(a10), features)

    def standardized(self, rows: pd.DataFrame) -> np.ndarray:
        return np.column_stack([(rows[f] - self.stats[f][0]) / self.stats[f][1] for f in self.features])

    def find_peers(self, iso3: str, k: int = 3, end_year: int | None = None) -> dict | None:
        """Closest matching windows from other countries that meet PEER_RULE, best window per country.
        end_year: the country's own window ends here (its snapshot year); default its latest measured year."""
        g = self.panel[self.panel.iso3 == iso3]
        if g.empty or not g.access_observed.any():
            return None
        observed = g.year[g.access_observed]
        end = int(observed[observed <= end_year].max()) if end_year is not None and (observed <= end_year).any() else int(observed.max())
        recent = g[(g.year > end - WINDOW) & (g.year <= end)]
        if len(recent) < WINDOW:
            return None
        now = float(recent.electricity_access_pct.iloc[-1])
        mask = ((self.iso3 != iso3) & (np.abs(self.access_start - now) <= PEER_BAND) & (self.access_start < 95)
                & ((self.access_after - self.access_start >= 10) | (self.access_after >= 95)))
        out = {"year": end, "access_now": now, "windows_searched": int(mask.sum()), "peers": []}
        if not mask.any():
            return out
        target = self.standardized(recent)
        others = self.iso3 != iso3
        all_d = dtw_batch(target, self.windows[others])
        # Similarity scale from every other country's best match, so % means the same as in an unfiltered search
        scale = float(pd.DataFrame({"iso3": self.iso3[others], "d": all_d}).groupby("iso3").d.min().median())
        d = all_d[mask[others]]
        best = pd.DataFrame({"iso3": self.iso3[mask], "end": self.end[mask], "d": d}).sort_values("d").drop_duplicates("iso3")
        for r in best.head(k).itertuples():
            o = self.panel[self.panel.iso3 == r.iso3].set_index("year")
            path = o.loc[r.end: r.end + HORIZON]
            out["peers"].append({
                "iso3": r.iso3, "country": str(o.country.iloc[0]), "year": int(r.end),
                "similarity": float(100 * np.exp(-r.d / scale)),
                "access": [float(v) for v in path.electricity_access_pct],
            })
        return out

    def find(self, iso3: str, k: int = 3) -> dict | None:
        g = self.panel[self.panel.iso3 == iso3]
        if g.empty or not g.access_observed.any():
            return None
        end = int(g.year[g.access_observed].max())  # latest year with measured electricity access
        recent = g[(g.year > end - WINDOW) & (g.year <= end)]
        if len(recent) < WINDOW:
            return None
        # Other countries only, and only those within 10x of this country's population
        mask = (self.iso3 != iso3) & (np.abs(self.log_pop - recent.log_population.iloc[-1]) <= np.log10(MAX_POP_RATIO))
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
                "population_then": float(o.loc[r.end, "population"]),
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
                "population_now": float(now.population),
                "twins": twins, "forecast": forecast, "windows_searched": int(mask.sum()), "countries_compared": int(len(best))}
