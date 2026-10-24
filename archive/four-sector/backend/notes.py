"""Plain-English sentences for the stress test, built only from model outputs and the data."""

import model


def money(v: float | None) -> str:
    if v is None:
        return "n/a"
    a = abs(v)
    if a >= 1e12:
        return f"${v / 1e12:.1f} trillion"
    if a >= 1e9:
        return f"${v / 1e9:.1f} billion"
    if a >= 1e6:
        return f"${v / 1e6:.0f} million"
    return f"${v:,.0f}"


def shock(name: str, before: dict, after: dict, iso3: str) -> str:
    word = model.resource_word(iso3)
    if name == "oil_price":
        return (f"Less {word} income means less to invest every year. Savings end at {money(after['fund'])} "
                f"instead of {money(before['fund'])}, because the fund is drained to keep projects going.")
    if name == "shutdown":
        text = f"One bad year cancels {money(after['shortfall_total'])} of planned spending before savings have grown."
        if model.revenue_history(iso3):
            drop = model.revenue_baseline(iso3)["biggest_drop"]
            if drop and drop["change"] < -0.5:
                text += (f" This has happened: {word} income fell from {money(drop['from']['revenue'])} in "
                         f"{drop['from']['year']} to {money(drop['to']['revenue'])} in {drop['to']['year']}.")
        return text
    lost = 1 - after["solar_mw"] / max(before["solar_mw"], 1)
    return f"When everything costs 25% more, the same money builds {lost:.0%} less solar and transport."
