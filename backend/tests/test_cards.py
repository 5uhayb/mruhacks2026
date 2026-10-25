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
        assert r.about is None, (iso3, kind)  # a chip naming the country's own peer must not switch country


def test_top_share_is_a_percentage_and_ranks_correctly():
    best = cards.best_by_country()["solar"]
    assert cards.top_share("solar", max(best)) == 1 or cards.top_share("solar", max(best)) <= 2
    assert cards.top_share("solar", min(best)) == 100
    assert cards.top_share("solar", 6.0) < cards.top_share("solar", 4.5)


def test_named_country_detection():
    assert cards.named_country("What about Mali?", "MRT") == "MLI"
    assert cards.named_country("How is the DRC doing?", "MRT") == "COD"
    assert cards.named_country("What should Mauritania do first?", "MRT") is None  # the open country is not a switch
    assert cards.named_country("How reliable is this plan?", "MRT") is None


def test_another_country_named_in_free_text_is_answered_about_that_country(app):
    r = app.ask_advisor(app.AdvisorRequest(iso3="MRT", question="What about Mali?"))
    assert r.about == {"iso3": "MLI", "name": "Mali"}
    assert "Mali" in r.answer or r.card["facts"]


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
