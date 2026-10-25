"""Answer cards for Ask Nahda: a one-line verdict, 2-3 label/value facts, one "why" sentence and a source line.

Every card is built from the same app data the advisor already uses. Plain words come first ("Very strong, top 8% of
countries"); exact values go in a small grey detail. A card never shows the same number twice. AI answers are asked for
the same shape and are kept only if they pass the same checks; otherwise the card built from data is shown."""

import json
import math
import re
from functools import lru_cache

import electric
import model

ICONS = {"sun", "wind", "bolt", "home", "shield", "people", "pin"}
KINDS = ("first", "peer", "people", "risk", "mix", "siting")


# ---------- Plain words ----------

@lru_cache
def best_by_country() -> dict:
    """Each country's best NASA solar and wind values, for 'top X% of countries'."""
    s = electric.sites()
    g = s.groupby("iso3")
    return {"solar": sorted(g.solar_kwh_m2_day.max().tolist()), "wind": sorted(g.wind_50m_ms.max().tolist())}


def top_share(kind: str, value: float) -> int:
    """'Top X%': the share of countries whose best spot is at least this good (1-100)."""
    vals = best_by_country()[kind]
    at_least = sum(1 for v in vals if v >= value - 1e-9)
    return max(1, min(100, math.ceil(at_least / len(vals) * 100)))


def strength(word: str) -> str:
    """'very strong sunlight' -> 'Very strong'."""
    w = word.replace(" sunlight", "").replace(" wind", "")
    return w[0].upper() + w[1:]


def people(n: float) -> str:
    """1263523 -> '1.3 million'; 48210 -> '48,000'."""
    if n >= 1e6:
        return f"{n / 1e6:.1f} million"
    if n >= 1e4:
        return f"{round(n, -3):,.0f}"
    return f"{round(n, -2):,.0f}"


PART = {"solar": "Solar", "wind": "Wind", "grid": "Power lines & batteries"}


# ---------- Checks ----------

NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def numbers(text: str) -> list[str]:
    """Numbers as written, normalised (commas dropped) so '1,200' and '1200' count as the same."""
    return [n.replace(",", "") for n in NUM.findall(text or "")]


def repeats(card: dict) -> set[str]:
    """Numbers that appear more than once across the verdict, fact values and why (details may restate a value)."""
    seen, dup = set(), set()
    for text in [card["verdict"], *(f["value"] for f in card["facts"]), card["why"]]:
        for n in set(numbers(text)):
            (dup if n in seen else seen).add(n)
    return dup


RANK = re.compile(r",? top (\d+)% of countries")


def tidy(card: dict) -> dict:
    """Remove repeated numbers, least important first. A fact that repeats a number already shown first loses its
    'top X% of countries' (moved into the grey detail); if it still repeats, it is dropped in favour of the next
    candidate fact. Then the 'why' sentence is dropped if it repeats. Keeps at most 3 facts."""
    seen = set(numbers(card["verdict"]))
    facts = []
    for f in card["facts"]:
        if set(numbers(f["value"])) & seen and RANK.search(f["value"]):
            rank = RANK.search(f["value"]).group(1)
            f = {**f, "value": RANK.sub("", f["value"]), "detail": f"top {rank}% · {f['detail']}" if f.get("detail") else f"top {rank}%"}
        if set(numbers(f["value"])) & seen or len(facts) == 3:
            continue
        seen |= set(numbers(f["value"]))
        facts.append(f)
    card = {**card, "facts": facts}
    if repeats(card):
        first = card["why"].split(". ")[0].rstrip(".") + "." if card["why"] else ""
        card = {**card, "why": first if first and not repeats({**card, "why": first}) else ""}
    return card


SHARE_WORDS = {0: "Almost no one", 1: "One in ten people", 2: "Two in ten people", 3: "Three in ten people", 4: "Four in ten people",
               5: "Half the people", 6: "Six in ten people", 7: "Seven in ten people", 8: "Eight in ten people",
               9: "Nine in ten people", 10: "Almost everyone"}


def valid(card: dict, data: str | None = None) -> bool:
    """A usable card: verdict, 2-3 facts with known icons, no repeated numbers, and (for AI cards) every number taken
    from the app's data."""
    try:
        if not card["verdict"] or not 2 <= len(card["facts"]) <= 3 or not isinstance(card["why"], str):
            return False
        if any(not f.get("label") or not f.get("value") or f.get("icon") not in ICONS for f in card["facts"]):
            return False
    except (KeyError, TypeError):
        return False
    if repeats(card):
        return False
    if data is not None:
        allowed = set(numbers(data)) | {str(i) for i in range(11)}  # small counts ("nine of ten") are fine
        shown = [card["verdict"], card["why"], *(f["value"] for f in card["facts"]), *(f.get("detail") or "" for f in card["facts"])]
        if any(n not in allowed and n.rstrip("0").rstrip(".") not in allowed for t in shown for n in numbers(t)):
            return False
    return True


def from_ai(text: str, data: str) -> dict | None:
    """Parse an AI answer written as a JSON card; None if it is not one or fails the checks."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    try:
        raw = json.loads(m.group(0))
    except ValueError:
        return None
    card = {"verdict": str(raw.get("verdict", "")).strip(), "why": str(raw.get("why", "")).strip(),
            "facts": [{"icon": str(f.get("icon", "")), "label": str(f.get("label", "")).strip(), "value": str(f.get("value", "")).strip(),
                       "detail": str(f.get("detail") or "").strip() or None} for f in raw.get("facts", []) if isinstance(f, dict)]}
    return card if valid(card, data) else None


AI_FORMAT = """Answer as ONE JSON object and nothing else:
{"verdict": "bold one-line answer, under 8 words",
 "facts": [{"icon": "sun|wind|bolt|home|shield|people|pin", "label": "1-2 words", "value": "plain words, short", "detail": "exact value with unit, or null"}],
 "why": "one short plain sentence"}
Give 2 or 3 facts. Prefer plain words and 'top X% of countries' over units; put exact values with units in "detail".
Never use the same number twice across verdict, fact values and why."""


# ---------- Which country, which question ----------

ALIASES = {"drc": "COD", "dr congo": "COD", "congo dr": "COD", "congo": "COD", "democratic republic of the congo": "COD",
           "congo kinshasa": "COD", "republic of congo": "COG", "republic of the congo": "COG", "congo brazzaville": "COG",
           "ivory coast": "CIV", "cote d'ivoire": "CIV", "burma": "MMR", "swaziland": "SWZ", "eswatini": "SWZ", "cape verde": "CPV",
           "laos": "LAO", "south korea": "KOR", "north korea": "PRK", "russia": "RUS", "syria": "SYR", "iran": "IRN",
           "egypt": "EGY", "yemen": "YEM", "venezuela": "VEN", "gambia": "GMB", "the gambia": "GMB", "uk": "GBR", "usa": "USA",
           "united states": "USA", "turkey": "TUR", "vietnam": "VNM", "kyrgyzstan": "KGZ", "slovakia": "SVK", "czechia": "CZE"}


@lru_cache
def country_names() -> list[tuple[str, str]]:
    """(lowercase name, iso3), longest first: World Bank names, their part before the comma, and common aliases."""
    panel = model.load()[0]
    usable = set(electric.sites().iso3)  # the same rule as main.check(): the country has NASA solar data
    out = {}
    for iso3, name in dict(zip(panel.iso3, panel.country)).items():
        if iso3 not in usable:
            continue
        out[normalise(name)] = iso3
        out[normalise(name.split(",")[0])] = iso3  # "Congo, Dem. Rep." -> "congo"
    out.update({k: v for k, v in ALIASES.items() if v in usable})
    return sorted(out.items(), key=lambda kv: -len(kv[0]))


def normalise(text: str) -> str:
    """Lowercase letters only, accents removed: 'Côte d'Ivoire!' -> 'cote d'ivoire'."""
    import unicodedata

    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z' ]", " ", t)).strip()


# Words that sit close to a country name but are not one ("chain" ~ "china", "spin" ~ "spain")
NOT_COUNTRIES = {"chain", "spin", "plan", "pain", "omen", "mail", "iran's", "india's", "power", "grids", "solar"}


def find_country(question: str) -> str | None:
    """Any country named in the question: exact names and aliases first (longest first, so 'south sudan' beats
    'sudan'), then small typos ('nigerai' -> Nigeria) on words of 5+ letters."""
    import difflib

    q = f" {normalise(question)} "
    names = country_names()
    for name, iso3 in names:
        if f" {name} " in q:
            return iso3
    lookup = dict(names)
    words = q.split()
    for n in (3, 2, 1):  # multi-word names first ("cote d'ivoire", "sierra leone")
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i:i + n])
            if len(phrase) < 5 or phrase in NOT_COUNTRIES:
                continue
            hit = difflib.get_close_matches(phrase, lookup, n=1, cutoff=0.84)
            if hit:
                return lookup[hit[0]]
    return None


def named_country(question: str, selected: str | None) -> str | None:
    """A country named in the question other than the selected one, if any."""
    iso3 = find_country(question)
    return iso3 if iso3 != selected else None


def kind_of(question: str) -> str | None:
    """Which question this is, from its words; None if nothing matches."""
    q = question.lower()
    if any(w in q for w in ("least electricity", "least power", "lowest", "worst", "most people without", "least access", "fewest")):
        return "least"
    if any(w in q for w in ("comeback", "success story", "turnaround", "came back")):
        return "comeback"
    if re.search(r"\b(twin|peer)s?\b", q) and any(w in q for w in ("pick", "choose", "chosen", "find", "select", "how does", "how do you", "work")):
        return "method"
    if any(w in q for w in ("peer", "twin", "differently", "succeed", "copy", "learn from")) or re.search(r"\bwhy\b.*\bdid\b", q):
        return "peer"
    if any(w in q for w in ("how many", "people", "by 20", "get power", "connected")):
        return "people"
    if any(w in q for w in ("reliab", "risk", "wrong", "fail", "shock", "safe")):
        return "risk"
    if any(w in q for w in ("first", "start", "priority", "should")):
        return "first"
    if any(w in q for w in ("where", "place", "site", "location")):
        return "siting"
    if any(w in q for w in ("solar", "wind", "sun", "mix")):
        return "mix"
    if any(w in q for w in ("tell me", "about", "overview", "plan", "summary", "explain", "what", "how", "why", "?")):
        return "first"  # a general question about a country gets the overview
    return None


# ---------- World cards (no country needed) ----------

def least(rows: list[dict]) -> dict:
    """rows: every country's latest access, lowest first ({iso3, name, access, year, region})."""
    top = rows[:3]
    regions = [r["region"] for r in rows[:10] if r.get("region")]
    common = max(set(regions), key=regions.count) if regions else None
    share = regions.count(common) if common else 0
    return tidy({
        "verdict": f"{top[0]['name']} has the least electricity",
        "facts": [{"icon": "home", "label": r["name"], "value": f"{r['access']:.0f}% have power", "detail": str(r["year"])} for r in top],
        "why": ("All ten lowest are in " if share == 10 else f"{SHARE_WORDS[share].split(' in ')[0]} of the ten lowest are in ") + f"{common}."
               if common and share >= 6 else "",
        "source": "Source: World Bank, latest year for each country",
    })


def comeback(s: dict) -> dict:
    """s: the strongest comeback among peers of the least-connected countries."""
    facts = [{"icon": "bolt", "label": "Ten years later", "value": f"{s['to']:.0f}% have power", "detail": f"from {s['from']:.0f}% in {s['year']}"}]
    if s.get("rural"):
        facts.append({"icon": "home", "label": "Villages", "value": f"{s['rural'][0]:.0f}% → {s['rural'][1]:.0f}% with power", "detail": None})
    facts.append({"icon": "pin", "label": "Lesson for", "value": s["for_name"], "detail": f"{s['for_access']:.0f}% have power today"})
    return tidy({
        "verdict": f"{s['peer']} brought power to {s['gain']:.0f}% more of its people in a decade",
        "facts": facts,
        "why": f"In {s['year']} its path looked like {s['for_name']}'s does now, which is why Nahda pairs them.",
        "source": f"Source: World Bank, {s['year']}–{s['year'] + 10}",
    })


def method() -> dict:
    """How Nahda picks a peer ('twin'): the rule behind the Peers tab, in plain words."""
    return {
        "verdict": "It looks for countries that were once where this one is, then pulled ahead",
        "facts": [{"icon": "pin", "label": "Same path", "value": "5 years of access, income and population", "detail": "dynamic time warping"},
                  {"icon": "home", "label": "Same start", "value": "within 15 points of today's access", "detail": "and below 95%"},
                  {"icon": "bolt", "label": "Then pulled ahead", "value": "gained at least 10 points in a decade", "detail": "or reached 95%"}],
        "why": "The closest matches that gained the most come first.",
        "source": "Source: World Bank data since 1990",
    }


# ---------- Cards from data ----------

def build(kind: str, c, p, sim, a: dict, population: float) -> dict:
    """The card for one question kind, from the app's numbers only."""
    r = c.profile["resources"]
    year = c.profile.get("year") or sim.start.get("access_year")
    end = (sim.start.get("access_year") or 2024) + 10
    sun, wind = r["solar"], r["wind"]
    sun_fact = {"icon": "sun", "label": "Sunlight", "value": f"{strength(electric.sun_word(sun['value'], a))}, top {top_share('solar', sun['value'])}% of countries",
                "detail": f"{sun['value']:.1f} kWh/m²/day · {sun['site']}"}
    wind_fact = {"icon": "wind", "label": "Wind", "value": f"{strength(electric.wind_word(wind['value'], a))}, top {top_share('wind', wind['value'])}% of countries",
                 "detail": f"{wind['value']:.1f} m/s at 50 m · {wind['site']}"}
    split = sim.split
    source_nasa = "Source: NASA POWER averages"
    access = c.profile["access"]["value"]

    if kind == "first":
        order = sorted(("solar", "wind", "grid"), key=lambda k: -split[k])
        lead, nxt = order[0], order[1]
        without = 100 - access
        why = {"grid": "Power has to reach homes first: new lines and batteries carry what the sun and wind produce.",
               "solar": "Sunlight is the strongest, cheapest source here, so solar leads and new lines carry it to homes.",
               "wind": "Wind gives more energy per dollar than sun here, so wind leads and new lines carry it to homes."}[lead]
        card = {"verdict": f"{PART[lead]} first, {PART[nxt].lower()} next",
                "facts": [sun_fact, wind_fact, {"icon": "home", "label": "Without power", "value": SHARE_WORDS[round(without / 10)],
                                                "detail": f"{without:.0f}% · {year}"}],
                "why": why, "source": f"{source_nasa}; World Bank, {year}"}

    elif kind == "peer":
        if not p.peers:
            return {"verdict": "No close peer found", "facts": [sun_fact, wind_fact],
                    "why": "No country with a similar path closed its gap fast enough to learn from.", "source": "Source: World Bank"}
        x = p.peers[0]
        series = x["detail"]["series"]
        y0, y1 = x["detail"]["years"]

        def change(col: str) -> tuple[float, float] | None:
            """First and last measured value of one column over the peer's 10 years."""
            vals = [s[col] for s in series if s.get(col) is not None]
            return (vals[0], vals[-1]) if len(vals) >= 2 else None

        # Candidates in order of interest; tidy() drops any that would repeat a number, keeping up to 3
        facts = []
        for col, icon, label, unit in (("rural", "home", "Villages", "with power"), ("urban", "home", "Cities", "with power"),
                                       ("clean", "bolt", "Clean power", "of supply")):
            ch = change(col)
            if ch and abs(ch[1] - ch[0]) >= 3:
                facts.append({"icon": icon, "label": label, "value": f"{ch[0]:.0f}% → {ch[1]:.0f}% {unit}", "detail": None})
        facts.append({"icon": "pin", "label": "Path match", "value": f"{x['similarity']:.0f}% similar to {c.name}'s", "detail": f"from {y0}"})
        why = ("Most of the gain came from villages, not cities." if x["detail"].get("from_villages")
               else "Cities and villages both gained.")
        if x["detail"].get("tradeoff"):
            why += " " + x["detail"]["tradeoff"]
        card = {"verdict": f"{x['country']} brought power to {x['access_change']:.0f}% more of its people in a decade",
                "facts": facts, "why": why, "source": f"Source: World Bank, {y0}–{y1}"}

    elif kind == "people":
        cards = sim.cards
        new = cards["access"]["people"]
        km = cards["grid"]["km"]
        why = ("New power lines are the limit: only homes near them can connect." if sim.limit == "lines"
               else "Generation is the limit: more solar and wind would connect more homes.")
        card = {"verdict": f"About {people(new)} more people with power by {end}",
                "facts": [{"icon": "home", "label": "Today", "value": f"{access:.0f}% have power", "detail": str(year)},
                          {"icon": "bolt", "label": f"By {end}", "value": f"{cards['access']['value']:.0f}% have power", "detail": "Nahda plan estimate"},
                          {"icon": "pin", "label": "Built", "value": f"{round(km, -2):,.0f} km of power lines",
                           "detail": f"{cards['solar']['mw'] + cards['wind']['mw']:,.0f} MW of solar & wind"}],
                "why": why, "source": f"Source: Nahda plan estimate; World Bank, {year}"}

    elif kind == "risk":
        f = sim.futures
        planned = sim.cards["access"]["value"]
        worst = min(sim.shocks.values(), key=lambda s: s["after"]["access_pct"])
        steady = f["access_p10"] >= planned - 5
        card = {"verdict": "Holds up in most futures" if steady else "Sensitive to lean budget years",
                "facts": [{"icon": "shield", "label": "Bad years", "value": f"{f['access_p10']:.0f}% have power in nine of ten futures",
                           "detail": f"{f['runs']} budget futures"},
                          {"icon": "bolt", "label": "Biggest risk", "value": f"{worst['label']}: {worst['after']['access_pct']:.0f}% instead of {planned:.0f}%",
                           "detail": None},
                          {"icon": "home", "label": "Safety money", "value": f"{split['reserve']:.0f}% of the budget kept back", "detail": "covers cost overruns"}],
                "why": sim.guardrails[0] if sim.guardrails else "Sun and wind vary, so batteries and the grid cover calm nights.",
                "source": "Source: Nahda stress test"}

    elif kind == "siting":
        sites = r["sites"]
        top_sun = max(sites, key=lambda s: s["solar"])
        top_wind = max(sites, key=lambda s: s["wind"])
        card = {"verdict": f"Sun at {top_sun['site']}, wind at {top_wind['site']}",
                "facts": [{**sun_fact, "label": "Best sun"}, {**wind_fact, "label": "Best wind"}],
                "why": "These are NASA point averages; real sites need local land and grid studies.", "source": source_nasa}

    else:  # mix: solar or wind?
        lead, other = ("solar", "wind") if split["solar"] >= split["wind"] else ("wind", "solar")
        card = {"verdict": f"{PART[lead]} first, {PART[other].lower()} second",
                "facts": [sun_fact, wind_fact, {"icon": "bolt", "label": "Plan split", "value": f"{split['solar']:.0f}% solar · {split['wind']:.0f}% wind",
                                                "detail": "share of the yearly budget"}],
                "why": "Both vary, so the grid and batteries fill the gaps.", "source": source_nasa}
    return tidy(card)
