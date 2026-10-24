"""What did a twin do differently? Compares a country's last 10 years with its twin's 10 years after the
match year, indicator by indicator, and writes the biggest differences as plain sentences from the data."""

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
HORIZON = 10
NEAREST = 2  # use the closest measured year within ±2 years when the exact year is missing
STALE = 5  # a country's own window ends at its latest measured year, if within 5 years of the match year

# key: (label, unit, source, kind). kind "pct" compares points; "level" compares % change.
INDICATORS = {
    "fixed_investment_pct_gdp": ("investment", "% of GDP", "World Bank NE.GDI.FTOT.ZS", "pct"),
    "fdi_pct_gdp": ("foreign direct investment", "% of GDP", "World Bank BX.KLT.DINV.WD.GD.ZS", "pct"),
    "manufacturing_pct_gdp": ("manufacturing", "% of GDP", "World Bank NV.IND.MANF.ZS", "pct"),
    "fuel_exports_pct": ("fuel exports", "% of merchandise exports", "World Bank TX.VAL.FUEL.ZS.UN", "pct"),
    "resource_rents_pct_gdp": ("natural resource rents", "% of GDP", "World Bank NY.GDP.TOTL.RT.ZS", "pct"),
    "renewable_electricity_pct": ("clean electricity", "% of electricity", "World Bank EG.ELC.RNEW.ZS", "pct"),
    "electricity_access_pct": ("electricity access", "% of people", "World Bank EG.ELC.ACCS.ZS", "pct"),
    "gdp_per_capita_usd": ("income per person", "US$", "World Bank NY.GDP.PCAP.CD", "level"),
}


@lru_cache
def panel() -> pd.DataFrame:
    p = pd.read_csv(DATA / "panel_raw.csv")
    path = DATA / "trade.csv"
    if path.exists():
        p = p.merge(pd.read_csv(path), on=["iso3", "year"], how="left")
    for k in INDICATORS:
        if k not in p:
            p[k] = np.nan
    return p.sort_values(["iso3", "year"])


@lru_cache
def typical_change() -> dict:
    """How much each indicator usually moves over 10 years worldwide (median absolute change), to rank differences fairly."""
    p = panel()
    out = {}
    for k, (_, _, _, kind) in INDICATORS.items():
        w = p.pivot_table(index="iso3", columns="year", values=k)
        a, b = w.iloc[:, :-HORIZON].to_numpy(), w.iloc[:, HORIZON:].to_numpy()
        d = np.log(b / a) * 100 if kind == "level" else b - a
        d = d[np.isfinite(d)]
        out[k] = float(np.median(np.abs(d))) if len(d) else 1.0
    return out


def value_at(iso3: str, key: str, year: int) -> tuple[float, int] | None:
    s = panel()
    s = s[(s.iso3 == iso3)][["year", key]].dropna()
    if s.empty:
        return None
    s = s.assign(dist=(s.year - year).abs()).sort_values(["dist", "year"])
    row = s.iloc[0]
    return (float(row[key]), int(row.year)) if row.dist <= NEAREST else None


def change(iso3: str, key: str, start: int, end: int) -> dict:
    a, b = value_at(iso3, key, start), value_at(iso3, key, end)
    if a is None or b is None or a[1] >= b[1]:
        return {"from": None, "to": None, "from_year": None, "to_year": None}
    return {"from": a[0], "to": b[0], "from_year": a[1], "to_year": b[1]}


def latest_change(iso3: str, key: str, now_year: int) -> dict:
    """The country's own last 10 years for one indicator, ending at its latest measured year."""
    s = panel()
    years = s[(s.iso3 == iso3) & (s.year <= now_year)][["year", key]].dropna().year
    if years.empty or years.max() < now_year - STALE:
        return change(iso3, key, now_year - HORIZON, now_year)
    end = int(years.max())
    return change(iso3, key, end - HORIZON, end)


def fmt(v: float, unit: str) -> str:
    if unit == "US$":
        return f"${v:,.0f}"
    return f"{v:.1f}%" + unit.removeprefix("%")


def moved(c: dict, kind: str) -> float:
    if kind == "level":
        return float(np.log(c["to"] / c["from"]) * 100) if c["from"] > 0 and c["to"] > 0 else 0.0
    return c["to"] - c["from"]


def phrase(who: str, label: str, c: dict, unit: str, kind: str) -> str:
    m = moved(c, kind)
    flat = abs(m) < (2 if kind == "level" else 0.5)
    if flat:
        return f"{who} kept {label} at about {fmt(c['to'], unit)}"
    if unit == "US$":
        return f"{who}'s {label} {'grew' if m > 0 else 'fell'} from {fmt(c['from'], unit)} to {fmt(c['to'], unit)}"
    return f"{who} {'raised' if m > 0 else 'cut'} {label} from {fmt(c['from'], unit).removesuffix(unit.removeprefix('%'))} to {fmt(c['to'], unit)}"


def compare(iso3: str, name: str, now_year: int, twin_iso3: str, twin_name: str, twin_year: int) -> dict:
    rows = []
    typical = typical_change()
    for k, (label, unit, source, kind) in INDICATORS.items():
        twin = change(twin_iso3, k, twin_year, twin_year + HORIZON)
        own = latest_change(iso3, k, now_year)
        score = None
        if twin["from"] is not None and own["from"] is not None:
            score = abs(moved(twin, kind) - moved(own, kind)) / (typical[k] or 1.0)
        rows.append({"key": k, "label": label, "unit": unit, "source": source, "twin": twin, "own": own, "score": score})

    ranked = sorted((r for r in rows if r["score"] is not None), key=lambda r: -r["score"])[:3]
    sentences = []
    for r in ranked:
        t, o, unit, kind = r["twin"], r["own"], r["unit"], INDICATORS[r["key"]][3]
        sentences.append(
            f"Over {t['from_year']}–{t['to_year']}, {phrase(twin_name, r['label'], t, unit, kind)}. "
            f"Over {o['from_year']}–{o['to_year']}, {phrase(name, r['label'], o, unit, kind)}."
        )
    return {"twin": twin_iso3, "twin_name": twin_name, "twin_years": [twin_year, twin_year + HORIZON],
            "own_years": [now_year - HORIZON, now_year], "rows": rows, "differences": sentences}


# ---------- Peer playbook ----------

SHIFTS = {  # indicators a twin's "what changed" line is chosen from
    "fixed_investment_pct_gdp": "Investment",
    "fdi_pct_gdp": "Foreign direct investment",
    "manufacturing_pct_gdp": "Manufacturing",
    "fuel_exports_pct": "Fuel exports",
    "renewable_electricity_pct": "Clean electricity",
}
TURNAROUND_RULE = ("Turnaround peer: over the 10 years after the match, electricity access rose by at least 10 points "
                   "(or reached 95%) and income per person did not fall. Otherwise: stagnated peer.")


def is_turnaround(access: list[float], gdp: list[float]) -> bool:
    return (access[-1] - access[0] >= 10 or access[-1] >= 95) and gdp[-1] >= gdp[0]


def shifts(iso3: str, year: int) -> dict:
    """Each shift indicator's change over the 10 years after `year`, scaled by a typical 10-year change (capped ±3)."""
    typical = typical_change()
    out = {}
    for k in SHIFTS:
        c = change(iso3, k, year, year + HORIZON)
        if c["from"] is not None:
            out[k] = {**c, "z": float(np.clip(moved(c, "pct") / (typical[k] or 1.0), -3, 3))}
    return out


def short(v: float, unit: str) -> str:
    return f"{v:.0f}%" if abs(v) >= 10 else f"{v:.1f}%"


def biggest_shift(iso3: str, year: int) -> str:
    s = shifts(iso3, year)
    if not s:
        return "No data on investment, trade or industry for these years."
    k, c = max(s.items(), key=lambda kv: abs(kv[1]["z"]))
    unit = INDICATORS[k][1].removeprefix("%")
    verb = "rose" if c["to"] > c["from"] else "fell"
    if abs(c["to"] - c["from"]) < 0.5:
        return f"{SHIFTS[k]} held at about {short(c['to'], unit)}{unit}."
    return f"{SHIFTS[k]} {verb} from {short(c['from'], unit)} to {short(c['to'], unit)}{unit}."


SECTOR_NAMES = {"solar": "Power", "rail": "Transportation", "industry": "Tourism & Economy", "fund": "Savings"}
GROWTH_WORDS = {"fixed_investment_pct_gdp": "investment", "renewable_electricity_pct": "renewables",
                "manufacturing_pct_gdp": "manufacturing", "fdi_pct_gdp": "foreign investment"}


def playbook(twin: dict, base: dict[str, int], sun: float, access_now: float, low: int = 10, high: int = 50) -> dict:
    """Heuristic: start from the Balanced split and move a quarter of the budget toward the sectors linked to the
    peer's biggest changes. Investment and renewables -> Power; investment, manufacturing and FDI -> Tourism & Economy;
    fuel export shifts (trade) -> Transportation; income that did not fall -> Savings. The country's own gap counts too:
    strong sun (>= 5 kWh/m2/day) with access below 90% -> more Power. Every sector stays within 10-50%."""
    s = shifts(twin["iso3"], twin["year"])
    z = {k: v["z"] for k, v in s.items()}
    score = dict.fromkeys(base, 0.0)
    why: dict[str, list[str]] = {k: [] for k in base}

    def add(sector, amount, reason):
        if amount > 0:
            score[sector] += amount
            why[sector].append(reason)

    inv = z.get("fixed_investment_pct_gdp", 0)
    add("solar", inv / 2, "investment")
    add("industry", inv / 2, "investment")
    add("solar", z.get("renewable_electricity_pct", 0), "renewables")
    add("industry", z.get("manufacturing_pct_gdp", 0), "manufacturing")
    add("industry", z.get("fdi_pct_gdp", 0), "foreign investment")
    fuel = z.get("fuel_exports_pct", 0)
    add("rail", abs(fuel), "trade moved away from fuel" if fuel < 0 else "fuel exports grew")
    if twin["gdp_per_capita"][-1] >= twin["gdp_per_capita"][0]:
        add("fund", 0.5, "income held steady")
    if sun >= 5 and access_now < 90:
        add("solar", 1.0, "sun is strong and access lags")

    total = sum(score.values())
    if total == 0:
        return {"split": dict(base), "lead": None, "explanation": f"Based on {twin['country']} {twin['year']}: no clear shifts, so Balanced."}
    target = {k: 0.75 * base[k] + 25 * score[k] / total for k in base}
    for _ in range(20):  # clip to the bounds and hand the excess or shortfall to the sectors with room
        clipped = {k: min(high, max(low, v)) for k, v in target.items()}
        gap = 100 - sum(clipped.values())
        free = [k for k in clipped if (gap > 0 and clipped[k] < high) or (gap < 0 and clipped[k] > low)]
        if abs(gap) < 1e-6 or not free:
            target = clipped
            break
        target = {k: v + (gap / len(free) if k in free else 0) for k, v in clipped.items()}
    split = {k: int(round(v)) for k, v in target.items()}
    split[max(split, key=split.get)] += 100 - sum(split.values())
    lead = max(base, key=lambda k: split[k] - base[k])
    reasons = list(dict.fromkeys(why[lead]))
    grew = [r for r in reasons if r in GROWTH_WORDS.values()]
    other = [r for r in reasons if r not in GROWTH_WORDS.values()]
    because = f"{' and '.join(grew[:2])} grew fastest" if grew else (other[0] if other else "of the peer's overall path")
    return {"split": split, "lead": lead,
            "explanation": f"Based on {twin['country']} {twin['year']}: more {SECTOR_NAMES[lead]} because {because}."}
