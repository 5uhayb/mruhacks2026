"""Tests for Ask Nahda's answer cards. Run from backend/: python -m pytest"""

import asyncio
import json

import pytest

import cards


@pytest.fixture(scope="module")
def app():
    """The real backend with its models loaded, as at server startup."""
    import main

    loop = asyncio.new_event_loop()
    ctx = main.lifespan(main.app)
    loop.run_until_complete(ctx.__aenter__())
    yield main
    loop.run_until_complete(ctx.__aexit__(None, None, None))
    loop.close()


def chip_questions(main, iso3):
    name = main.model.latest(iso3)["country"]
    peer = main.peers(iso3).peers
    end = (main.simulate(main.SimulateRequest(iso3=iso3)).start["access_year"] or 2024) + 10
    return [(f"What should {name} do first?", "first"), (f"What did {peer[0]['country']} do differently?", "peer"),
            (f"How many people would get power by {end}?", "people"), ("How reliable is this plan?", "risk"),
            ("Is solar or wind smarter here?", "mix"), ("Where should it build?", "siting")]


@pytest.mark.parametrize("iso3", ["MRT", "AFG", "NGA"])
def test_every_chip_gives_a_well_formed_card(app, iso3):
    """Verdict, 2-3 facts with known icons, a source; no number repeated; answered about the open country."""
    for question, kind in chip_questions(app, iso3):
        r = app.ask_advisor(app.AdvisorRequest(iso3=iso3, question=question, kind=kind))
        c = r.card
        assert c and c["verdict"] and c["source"].startswith("Source:"), (iso3, kind)
        assert 2 <= len(c["facts"]) <= 3 and all(f["icon"] in cards.ICONS and f["value"] for f in c["facts"]), (iso3, kind, c)
        assert not cards.repeats(c), (iso3, kind, c)
        assert r.select is None, (iso3, kind)  # a chip naming the country's own peer must not switch country


def test_top_share_is_a_percentage_and_ranks_correctly():
    best = cards.best_by_country()["solar"]
    assert cards.top_share("solar", max(best)) == 1 or cards.top_share("solar", max(best)) <= 2
    assert cards.top_share("solar", min(best)) == 100
    assert cards.top_share("solar", 6.0) < cards.top_share("solar", 4.5)


@pytest.mark.parametrize("text, iso3", [
    ("Sudan", "SDN"), ("sudan", "SDN"), ("south sudan please", "SSD"), ("What about Mali?", "MLI"), ("How is the DRC doing?", "COD"),
    ("congo", "COD"), ("republic of congo", "COG"), ("Ivory Coast", "CIV"), ("tell me about nigerai", "NGA"), ("sierra leone", "SLE"),
])
def test_country_names_are_found_with_aliases_and_small_typos(text, iso3):
    assert cards.find_country(text) == iso3


@pytest.mark.parametrize("text", ["How reliable is this plan?", "I need a chain of answers", "how is the power grid", "asdfgh"])
def test_ordinary_words_are_not_mistaken_for_countries(text):
    assert cards.find_country(text) is None


def test_the_open_country_is_not_a_switch():
    assert cards.named_country("What should Mauritania do first?", "MRT") is None


@pytest.mark.parametrize("selected", [None, "MRT"])
def test_a_named_country_is_selected_and_answered_about(app, selected):
    """'Sudan' with or without a country open: select Sudan on the globe and answer with its overview card."""
    r = app.ask_advisor(app.AdvisorRequest(iso3=selected, question="Sudan"))
    assert r.select == {"iso3": "SDN", "name": "Sudan"}
    assert r.card and not cards.repeats(r.card)


def test_starters_without_a_country_each_get_a_card_from_data(app):
    for kind in ("least", "comeback", "method"):
        r = app.ask_advisor(app.AdvisorRequest(question=app.STARTERS[("least", "comeback", "method").index(kind)]))
        assert r.card and 2 <= len(r.card["facts"]) <= 3 and not cards.repeats(r.card), kind
        assert r.suggestions, kind
    least = app.ask_advisor(app.AdvisorRequest(question="Which countries have the least electricity?"))
    lowest = app.world_rows()[0]
    assert least.card["verdict"].startswith(lowest["name"]) and lowest["access"] <= app.world_rows()[1]["access"]


def test_greetings_and_unclear_messages_get_a_short_reply_with_chips(app):
    hi = app.ask_advisor(app.AdvisorRequest(question="hi"))
    assert hi.card is None and hi.suggestions == app.STARTERS and len(hi.answer) < 120
    unclear = app.ask_advisor(app.AdvisorRequest(question="asdfgh"))
    assert unclear.card is None and unclear.suggestions == app.STARTERS
    hi_country = app.ask_advisor(app.AdvisorRequest(iso3="MRT", question="hello"))
    assert "Mauritania" in hi_country.answer and len(hi_country.suggestions) == 4


@pytest.mark.parametrize("question, iso3, kind", [("hi", None, None), ("asdfgh", None, None), ("blorp", "MRT", None),
                                                   ("How reliable is this plan?", "MRT", "risk")])
def test_never_the_same_reply_twice_in_a_row(app, question, iso3, kind):
    first = app.ask_advisor(app.AdvisorRequest(iso3=iso3, question=question, kind=kind))
    again = app.ask_advisor(app.AdvisorRequest(iso3=iso3, question=question, kind=kind, previous=first.answer))
    assert again.answer != first.answer and again.suggestions


def test_tidy_removes_repeated_numbers_least_important_first():
    card = {"verdict": "Solar first", "why": "Sun is at 40% here.", "source": "Source: x",
            "facts": [{"icon": "sun", "label": "Sunlight", "value": "Strong, top 40% of countries", "detail": "6 kWh"},
                      {"icon": "wind", "label": "Wind", "value": "Moderate, top 40% of countries", "detail": "5 m/s"},
                      {"icon": "bolt", "label": "Split", "value": "40% solar", "detail": None},
                      {"icon": "home", "label": "Homes", "value": "Half the people", "detail": None}]}
    out = cards.tidy(card)
    assert not cards.repeats(out) and 2 <= len(out["facts"]) <= 3
    assert out["facts"][1]["value"] == "Moderate" and "top 40%" in out["facts"][1]["detail"]  # rank moved to detail


def test_ai_cards_are_kept_only_if_they_pass_the_checks():
    data = "Access 47.7% (2021). Best solar 6.38 kWh/m2/day. Wind 7.00 m/s."
    good = {"verdict": "Solar first", "why": "Sun is the cheapest source.",
            "facts": [{"icon": "sun", "label": "Sunlight", "value": "Very strong", "detail": "6.38 kWh/m²/day"},
                      {"icon": "wind", "label": "Wind", "value": "Promising", "detail": "7.00 m/s"}]}
    assert cards.from_ai("Here you go:\n" + json.dumps(good), data)
    invented = {**good, "facts": [*good["facts"][:1], {"icon": "home", "label": "Homes", "value": "93% have power", "detail": None}]}
    assert cards.from_ai(json.dumps(invented), data) is None  # 93 is not in the data
    repeated = {**good, "verdict": "47.7% have power", "facts": [*good["facts"][:1], {"icon": "home", "label": "Today", "value": "47.7%", "detail": None}]}
    assert cards.from_ai(json.dumps(repeated), data) is None
    assert cards.from_ai("Solar is a good fit.", data) is None  # not a card at all
