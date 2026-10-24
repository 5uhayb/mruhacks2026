"""Analyst notes: deterministic plain-English sentences built only from the data and assumptions."""

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
        return f"{v / 1e6:.1f} million"
    if v >= 1e3:
        return f"{v / 1e3:,.0f},000" if v < 1e5 else f"{v / 1e3:,.0f} thousand"
    return f"{v:,.0f}"


def small_pct(v: float | None) -> str:
    """0.02% stays 0.02%, not 0.0%."""
    v = v or 0.0
    return f"{v:.2f}%" if v < 1 else f"{v:.1f}%"


def one_in(share_pct: float) -> str:
    n = round(100 / share_pct)
    return f"1 in {n}" if n >= 2 else f"{share_pct:.0f}%"


# ---------- Metric notes ----------

def electricity(iso3: str) -> str:
    s = model.series(iso3, "electricity_access_pct")
    if not s:
        return "No World Bank data on electricity access."
    v = s[-1]["value"]
    peak = max(s, key=lambda r: r["value"])
    lacking = 100 - v
    if lacking < 1:
        return "Almost everyone has a grid connection; the issues are reliability and the fuel it burns, not access."
    people = model.latest(iso3)["population"] * lacking / 100
    text = f"Roughly {one_in(lacking)} people ({big(people)}) have no electricity connection."
    if peak["value"] - v > 10:
        text += (f" Access was {peak['value']:.1f}% in {peak['year']}, so this is lost ground, "
                 "not a gap that was never closed.")
    return text


def renewable(iso3: str) -> str:
    lat = model.latest(iso3)
    v = lat["renewable_electricity_pct"]
    if v is None:
        return "No World Bank data on renewable electricity."
    best = model.sites_for(iso3).iloc[0]
    oslo = model.sites_for("NOR").iloc[0]
    ratio = best.solar_kwh_m2_day / oslo.solar_kwh_m2_day
    if v < 1:
        return (f"Almost none of the electricity is renewable ({v:.2f}%), although {best.site} receives "
                f"{best.solar_kwh_m2_day:.1f} kWh/m² of sunlight a day, {ratio:.1f}× Oslo.")
    if v < 30:
        return f"About {v:.0f}% of electricity is renewable; most still comes from burning fuel that could be exported."
    return f"{v:.0f}% of electricity is already renewable, mostly from existing sources such as hydropower."


def oil_rents(iso3: str) -> str:
    v = model.latest(iso3)["oil_rents_pct_gdp"]
    if v is None:
        return "No World Bank data on oil rents."
    if v > 50:
        return "More than half of the economy rises and falls with oil prices."
    if v > 30:
        return "More than a third of the economy rises and falls with oil prices."
    if v > 10:
        return "Oil is a large but not dominant part of the economy."
    return "Oil is a small share of output; resource revenue is a supplement, not the base."


def gdp_per_capita(iso3: str) -> str:
    v, nor = model.latest(iso3)["gdp_per_capita_usd"], model.latest("NOR")["gdp_per_capita_usd"]
    if v is None:
        return "No World Bank data on GDP per capita."
    return f"Output per person is {v / nor:.0%} of Norway's, the benchmark for turning oil into lasting wealth."


def governance(iso3: str, a: dict) -> str:
    rate, nor = model.discount_rate(iso3, a), model.discount_rate("NOR", a)
    return (f"This score sets the cost of capital in the model: investors would ask about {rate:.1%} a year "
            f"to fund a solar farm here, versus {nor:.1%} in Norway.")


def revenue(iso3: str) -> str:
    rb = model.revenue_baseline(iso3)
    pop = model.latest(iso3)["population"]
    w, b = rb["worst"], rb["best"]
    text = f"{money(rb['avg'])} a year is about ${rb['avg'] / pop:,.0f} per person."
    if w["revenue"] < 0.5 * b["revenue"]:
        text += (f" It swings hard: {money(w['revenue'])} in {w['year']} against {money(b['revenue'])} in "
                 f"{b['year']}. Anything funded from it needs a buffer.")
    return text


def potential(iso3: str, a: dict) -> str:
    best = model.sites_for(iso3).iloc[0]
    mwh = model.FARM_MW * best.solar_kwh_m2_day * 365 * a["performance_ratio"]
    homes = mwh * 1000 / a["kwh_per_home"]
    return (f"A {model.FARM_MW} MW farm at {best.site} would produce about {mwh / 1000:,.0f} GWh a year, "
            f"enough for roughly {big(homes)} homes.")


METRIC_NOTES = {
    "electricity_access_pct": electricity,
    "renewable_electricity_pct": renewable,
    "oil_rents_pct_gdp": oil_rents,
    "gdp_per_capita_usd": gdp_per_capita,
}


# ---------- Panel READ lines ----------

def read_revenue(iso3: str) -> str:
    rb = model.revenue_baseline(iso3)
    ratio = rb["worst"]["revenue"] / rb["best"]["revenue"]
    return (f"READ: The 5-year average is {money(rb['avg'])}, but the worst recent year brought in "
            f"{ratio:.0%} of the best. The plan has to survive that swing.")


def read_energy(iso3: str) -> str:
    lat = model.latest(iso3)
    return (f"READ: The grid reaches {lat['electricity_access_pct']:.0f}% of people and "
            f"{small_pct(lat['renewable_electricity_pct'])} of its output is renewable.")


def read_potential(iso3: str) -> str:
    ranked = sorted(model.peers(), key=lambda p: -p["best_solar"])
    rank = next(i for i, p in enumerate(ranked, 1) if p["iso3"] == iso3)
    text = f"READ: The country ranks #{rank} of {len(ranked)} for sunlight at its best site."
    has_revenue = model.revenue_baseline(iso3)["avg"] > 0
    renew = model.latest(iso3)["renewable_electricity_pct"] or 0
    if rank <= 3 and has_revenue and renew < 10:
        return text + " The revenue and the sun are both here; what is missing is a mechanism that turns one into the other."
    if renew >= 50:
        return text + " Most electricity is already renewable, so solar here competes with existing clean supply."
    return text + " Solar is viable but not exceptional; its case rests on the fuel it frees for export."


def read_peers(iso3: str) -> str:
    p = model.peers()
    rank = next(i for i, r in enumerate(p, 1) if r["iso3"] == iso3)
    return f"READ: Ranks #{rank} of {len(p)} on Untapped Potential: sun, revenue to invest, and little renewable power so far."


def read_overview(iso3: str) -> str:
    lat = model.latest(iso3)
    rb = model.revenue_baseline(iso3)
    best = model.sites_for(iso3).iloc[0]
    return (f"READ: The asset is {money(rb['avg'])} a year of resource revenue. The gap is "
            f"{100 - lat['electricity_access_pct']:.0f}% of people without power and "
            f"{small_pct(lat['renewable_electricity_pct'])} renewable electricity. The opportunity is "
            f"{best.solar_kwh_m2_day:.1f} kWh/m²/day of sun at {best.site}.")


# ---------- Allocation, deal, stress ----------

def allocation(share: float, pool: float, pop: float, revenue: float) -> str:
    pct = round(share * 100)
    return (f"Diverting {pct}% leaves {100 - pct}% for current spending; the question is what that {pct}% builds. "
            f"{money(pool)} a year is about ${pool / pop:,.0f} per person.")


def value_chart(rows: list[dict]) -> str:
    breakeven = next((r["year"] for r in rows if r["value_created"] >= r["capital_deployed"] > 0), None)
    if breakeven:
        return f"Value created overtakes capital deployed in year {breakeven}."
    last = rows[-1]
    return (f"By year 10, {money(last['capital_deployed'])} is deployed and {money(last['value_created'])} of value is "
            "created. Rail benefits are not modelled, so this understates the return.")


def deal_notes(d: dict, a: dict) -> dict:
    top = d["sensitivity"][0]

    def fmt(key, v):
        unit = model.ASSUMPTIONS[key]["unit"]
        if unit.startswith("$"):
            return f"${v:,.0f}{unit[1:]}"
        if unit in ("ratio", "/yr", "rate"):
            return f"{v:.1%}" if unit != "ratio" else f"{v:.2f}"
        return f"{v:g} {unit}"

    def pct(v):
        return "n/a" if v is None else f"{v:.1%}"

    return {
        "building": (f"A {d['mw']:.0f} MW farm at {d['site']} producing {d['annual_mwh'] / 1000:,.0f} GWh a year: "
                     f"enough for about {big(d['homes'])} homes, or {d['share_of_national_use']:.1%} of national electricity use."),
        "pays": (f"Each MWh avoids burning {a['heat_rate']:g} MMBtu of oil or gas at home. At ${a['fuel_value']:g}/MMBtu "
                 f"export value, the farm frees about {money(d['annual_value'])} a year of fuel for export."),
        "breaks": (f"{top['label']} moves the result most: at {fmt(top['key'], top['low_value'])} the IRR is "
                   f"{pct(top['irr_at_low'])}; at {fmt(top['key'], top['high_value'])} it is {pct(top['irr_at_high'])}."),
        "same_farm": "The sun is the same; the cost of risk is not.",
    }


def shock(name: str, before: dict, after: dict, iso3: str) -> str:
    rb = model.revenue_baseline(iso3)
    drop = rb["biggest_drop"]
    if name == "oil_price":
        return (f"Less revenue and cheaper fuel at once: the fund ends at {money(after['fund'])} instead of "
                f"{money(before['fund'])}, and each MWh of solar is worth 40% less.")
    if name == "shutdown":
        text = (f"The fund covers what it can of year 1; projects lose "
                f"{money(after['shortfall_total'])} of planned spending.")
        if drop and drop["change"] < -0.5:
            text += (f" Precedent: revenue fell from {money(drop['from']['revenue'])} in {drop['from']['year']} "
                     f"to {money(drop['to']['revenue'])} in {drop['to']['year']} ({drop['change']:.0%}).")
        return text
    if name == "capex":
        return (f"The same money builds less: {after['solar_mw']:,.0f} MW of solar instead of "
                f"{before['solar_mw']:,.0f}, and {after['rail_km']:,.0f} km of rail instead of {before['rail_km']:,.0f}.")
    return (f"The plan is paid for in cash, so nothing physical changes. Financing gets dearer: the flagship solar "
            f"farm's NPV moves from {money(before['deal_npv'])} to {money(after['deal_npv'])}.")


def monte_carlo(p_funded: float, homes_p10: float, fund_p10: float) -> str:
    return (f"In 9 out of 10 simulated futures, the plan still delivers at least {big(homes_p10)} homes' worth of power and "
            f"{money(fund_p10)} in savings by year 10. It meets every year's project commitment in "
            f"{p_funded:.0%} of futures; shortfalls happen when oil falls before the fund has grown.")


TERM_LABELS = {
    "term_buffer": "savings buffer",
    "term_new_income": "new non-oil income",
    "term_clean_power": "clean power",
    "term_access": "grid access",
}


def resilience(today: dict, year10: dict) -> str:
    moved = max(TERM_LABELS, key=lambda k: year10[k] - today[k])
    return (f"The score moves from {today['resilience']:.0f} to {year10['resilience']:.0f}. The largest gain is "
            f"{TERM_LABELS[moved]} ({today[moved]:.2f} → {year10[moved]:.2f}).")
