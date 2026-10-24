"""Short analyst notes: one plain-English line each, built only from the data and assumptions."""

import model


def money(v: float | None) -> str:
    if v is None:
        return "n/a"
    a = abs(v)
    if a >= 1e12:
        return f"${v / 1e12:.1f}T"
    if a >= 1e9:
        return f"${v / 1e9:.1f}B"
    if a >= 1e6:
        return f"${v / 1e6:.0f}M"
    return f"${v:,.0f}"


def big(v: float) -> str:
    if v >= 1e6:
        return f"{v / 1e6:.1f}M"
    if v >= 1e3:
        return f"{v / 1e3:.0f}K"
    return f"{v:,.0f}"


def no_power(iso3: str) -> str:
    s = model.series(iso3, "electricity_access_pct")
    v = s[-1]["value"]
    peak = max(s, key=lambda r: r["value"])
    lacking = 100 - v
    if lacking < 1:
        return "Almost everyone is connected."
    n = round(100 / lacking)
    text = f"1 in {n} people." if n >= 2 else f"{lacking:.0f}% of people."
    if peak["value"] - v > 10:
        text += f" Access was {peak['value']:.1f}% in {peak['year']}."
    return text


def clean(iso3: str) -> str:
    v = model.latest(iso3)["renewable_electricity_pct"] or 0
    if v < 1:
        return "Almost all power comes from burning oil and gas."
    if v < 30:
        return "Most power still comes from burning fuel."
    return "Already mostly renewable."


def oil_money(iso3: str) -> str:
    rb = model.revenue_baseline(iso3)
    w, b = rb["worst"], rb["best"]
    return f"Swings from {money(w['revenue'])} ({w['year']}) to {money(b['revenue'])} ({b['year']})."


def sun(iso3: str) -> str:
    best = model.sites_for(iso3).iloc[0]
    oslo = model.sites_for("NOR").iloc[0]
    return f"{best.solar_kwh_m2_day / oslo.solar_kwh_m2_day:.1f}× the sunlight of Oslo."


def deal_notes(d: dict, a: dict) -> dict:
    top = d["sensitivity"][0]
    lo = "n/a" if top["irr_at_low"] is None else f"{top['irr_at_low']:.1%}"
    return {
        "building": f"Powers about {big(d['homes'])} homes ({d['share_of_national_use']:.1%} of the country's use).",
        "pays": f"Frees {money(d['annual_value'])} a year of oil and gas for export.",
        "breaks": f"Biggest risk: {top['label'].lower()}. At the low end, IRR falls to {lo}.",
        "same_farm": "Same sun, higher risk: money costs more here.",
    }


def shock(name: str, before: dict, after: dict, iso3: str) -> str:
    if name == "oil_price":
        return f"Savings end at {money(after['fund'])} instead of {money(before['fund'])}."
    if name == "shutdown":
        drop = model.revenue_baseline(iso3)["biggest_drop"]
        text = f"Projects lose {money(after['shortfall_total'])} of planned spending."
        if drop and drop["change"] < -0.5:
            text += f" This happened in {drop['to']['year']}: revenue {drop['change']:.0%}."
        return text
    if name == "capex":
        return f"Builds {1 - after['solar_mw'] / max(before['solar_mw'], 1):.0%} less solar and rail."
    return f"Nothing built changes. Solar farm NPV: {money(before['deal_npv'])} → {money(after['deal_npv'])}."
