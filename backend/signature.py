"""Each country's "signature": its 2-3 most distinctive facts, chosen automatically.

For every indicator we compute the country's world percentile (latest value) and how it changed over
~20 years. Facts where the country is most extreme, or changed most, win. Wording comes from templates
filled with the numbers; nothing is invented."""

from functools import lru_cache

import numpy as np
import pandas as pd

import model

RECENT = 5  # a "latest" value must be from the last 5 years of data
SPAN = 20  # years for the change facts

# indicator: (unit, fact templates for high / low values)
LEVELS = {
    "electricity_access_pct": ("%", "Electricity reaches {v} of people, more than in {p}% of countries.",
                               "Only {v} of people have electricity, fewer than in {q}% of countries."),
    "renewable_electricity_pct": ("%", "{v} of electricity is renewable, more than in {p}% of countries.",
                                  "{v} of electricity is renewable, less than in {q}% of countries."),
    "gdp_per_capita_usd": ("$", "Income per person is {v}, higher than in {p}% of countries.",
                           "Income per person is {v}, lower than in {q}% of countries."),
    "kwh_per_person": ("kWh", "Each person uses {v} of electricity a year, more than in {p}% of countries.",
                       "Each person uses {v} of electricity a year, less than in {q}% of countries."),
    "urban_pct": ("%", "{v} of people live in cities, more than in {p}% of countries.",
                  "{v} of people live in cities, fewer than in {q}% of countries."),
    "investment_pct_gdp": ("%", "Investment is {v} of GDP, higher than in {p}% of countries.",
                           "Investment is {v} of GDP, lower than in {q}% of countries."),
}
CHANGES = {
    "electricity_access_pct": "Electricity access",
    "renewable_electricity_pct": "Clean electricity",
    "urban_pct": "The share living in cities",
}
RENTS = {"oil": "oil_rents_pct_gdp", "minerals": "mineral_rents_pct_gdp", "coal": "coal_rents_pct_gdp",
         "gas_forest": "gas_forest_rents_pct_gdp"}
NOUN = {"oil": "Oil", "minerals": "Mining", "coal": "Coal", "gas_forest": "Gas and forest"}


def fmt(v: float, unit: str) -> str:
    if unit == "$":
        return f"${v:,.0f}"
    if unit == "kWh":
        return f"{v:,.0f} kWh"
    if 0 < v < 1:
        return f"{v:.2f}%"
    if 99.5 <= v < 100 or v < 10:
        return f"{v:.1f}%"  # 99.8% must not round up to 100%
    return f"{v:.0f}%"


@lru_cache
def world() -> dict:
    """Latest value (within 5 years) and ~20-year change for every country and indicator."""
    panel, _, _ = model.load()
    last = int(panel.year.max())
    out = {}
    for col in [*LEVELS, *RENTS.values()]:
        if col not in panel:
            continue
        s = panel[["iso3", "year", col]].dropna()
        latest = s[s.year > last - RECENT].sort_values("year").groupby("iso3").last()
        then = s.merge(latest[["year"]].rename(columns={"year": "y1"}), left_on="iso3", right_index=True)
        then = then[(then.year <= then.y1 - SPAN + 2) & (then.year >= then.y1 - SPAN - 2)].sort_values("year").groupby("iso3").first()
        out[col] = {"latest": latest, "then": then}
    return out


def pct_rank(values: pd.Series, v: float) -> float:
    """Share of countries with a lower value, in percent."""
    return float((values < v).mean() * 100)


def facts(iso3: str) -> list[dict]:
    """All candidate facts for a country, each with a distinctiveness score."""
    w = world()
    out = []

    def add(col, score, text, value, year, percentile, kind):
        base = col.split(":")[0]
        unit = LEVELS[base][0] if base in LEVELS else "%"
        out.append({"indicator": col, "unit": unit, "score": score, "text": text, "value": value, "year": int(year),
                    "percentile": percentile, "kind": kind, "sparkline": model.series(iso3, base, SPAN)})

    for col, (unit, high, low) in LEVELS.items():
        if col not in w or iso3 not in w[col]["latest"].index:
            continue
        lat = w[col]["latest"]
        v, y = float(lat.loc[iso3, col]), lat.loc[iso3, "year"]
        p = pct_rank(lat[col], v)
        template = high if p >= 50 else low
        # Never claim "100% of countries": the country itself is one of them
        add(col, abs(p - 50) / 50, template.format(v=fmt(v, unit), p=min(99, round(p)), q=min(99, round(100 - p))), v, y, p, "level")

        # Change over ~20 years, ranked against every country's change
        then = w[col]["then"]
        if iso3 in then.index:
            both = then[[col, "year"]].join(lat[[col]], lsuffix="_then", rsuffix="_now", how="inner")
            change = (both[f"{col}_now"] / both[f"{col}_then"] - 1) if unit == "$" else (both[f"{col}_now"] - both[f"{col}_then"])
            c, v0, y0 = float(change.loc[iso3]), float(then.loc[iso3, col]), int(then.loc[iso3, "year"])
            pc = pct_rank(change, c)
            if col == "electricity_access_pct" and c <= -5:
                # Decline: measure from the peak of the last 25 years, not an arbitrary start year
                hist = [r for r in model.series(iso3, col) if r["year"] > int(y) - 25]
                peak = max(hist, key=lambda r: r["value"])
                add(col + ":change", 1.3, f"Electricity access fell from {fmt(peak['value'], unit)} in {peak['year']} "
                    f"to {fmt(v, unit)} in {int(y)}.", v, y, pc, "decline")
            elif unit == "$" and abs(pc - 50) > 30:
                verb = "grew" if c > 0 else "fell"
                pace = f"faster than in {round(pc)}%" if pc >= 50 else f"slower than in {round(100 - pc)}%"
                add(col + ":change", abs(pc - 50) / 50 * 1.05,
                    f"Income per person {verb} {abs(c):.0%} since {y0}, {pace} of countries.", v, y, pc, "change")
            elif col in CHANGES and abs(c) >= 5 and abs(pc - 50) > 30:
                name = CHANGES[col]
                text = (f"{name} rose from {fmt(v0, unit)} in {y0} to {fmt(v, unit)}, a bigger rise than in {round(pc)}% of countries."
                        if c > 0 else f"{name} fell from {fmt(v0, unit)} in {y0} to {fmt(v, unit)}.")
                add(col + ":change", abs(pc - 50) / 50 * 1.05, text, v, y, pc, "change")

    # Main resource: how dependent the economy is on it
    res = model.main_resource(iso3)
    col = RENTS[res]
    if col in w and iso3 in w[col]["latest"].index:
        lat = w[col]["latest"]
        v, y = float(lat.loc[iso3, col]), lat.loc[iso3, "year"]
        p = pct_rank(lat[col], v)
        if v >= 1:
            add(col, abs(p - 50) / 50, f"{NOUN[res]} rents are {fmt(v, '%')} of the economy, more than in {min(99, round(p))}% of countries.", v, y, p, "resource")
        access = model.latest(iso3)["electricity_access_pct"] or 0
        if access >= 99 and v >= 15:
            add(col + ":diversify", 1.15, f"Electricity reaches everyone, but {fmt(v, '%')} of the economy depends on {NOUN[res].lower()}: "
                "the challenge is diversification, not access.", v, y, p, "diversify")
    return out


def signature(iso3: str, n: int = 3) -> list[dict]:
    """The n most distinctive facts, at most one per indicator."""
    chosen, used = [], set()
    for f in sorted(facts(iso3), key=lambda f: -f["score"]):
        base = f["indicator"].split(":")[0]
        if base in used:
            continue
        chosen.append(f)
        used.add(base)
        if len(chosen) == n:
            break
    return chosen
