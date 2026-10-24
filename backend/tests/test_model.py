"""Tests for the core calculations. Run from backend/: python -m pytest"""

import numpy as np
import pytest

import model
import signature
from ml.twins import TwinIndex, dtw_batch, load_panel


@pytest.fixture(scope="module")
def twin_index():
    return TwinIndex.build(load_panel())


# ---------- Solar ----------

def test_solar_output_matches_formula():
    """Yearly MWh = MW × sunlight (kWh/m²/day) × 365 × performance ratio."""
    import electric

    a = electric.params()
    ctx = {"population": 1e6, "access0": 50.0, "renew0": 0.0, "demand_mwh": 1e6, "solar": 6.0, "wind": 0.0}
    r = electric.simulate(ctx, a, 1e9, {"solar": 100, "wind": 0, "grid": 0}, np.ones((1, electric.YEARS)))
    assert r["solar_mwh"][0, -1] == pytest.approx(r["solar_mw"][0, -1] * 6.0 * 365 * a["performance_ratio"])


# ---------- Finance ----------

def test_irr_of_simple_cash_flows():
    # Invest 100, get 110 back a year later: 10% return
    assert model.irr([-100, 110]) == pytest.approx(0.10, abs=1e-6)
    # NPV at the IRR is zero
    flows = [-1000, 300, 300, 300, 300, 300]
    assert model.npv(model.irr(flows), flows) == pytest.approx(0, abs=1e-6)


def test_payback_interpolates_within_a_year():
    assert model.payback([-100, 40, 40, 40]) == pytest.approx(2.5)
    assert model.payback([-100, 10, 10]) is None


def test_assumption_overrides_are_clipped_to_range():
    import electric

    p = electric.params({"solar_capex_per_mw": 1, "wind_threshold": 999})
    assert p["solar_capex_per_mw"] == electric.ASSUMPTIONS["solar_capex_per_mw"]["min"]
    assert p["wind_threshold"] == electric.ASSUMPTIONS["wind_threshold"]["max"]


# ---------- Twins ----------

def test_dtw_is_zero_for_identical_sequences():
    x = np.random.default_rng(0).normal(size=(5, 3))
    d = dtw_batch(x, np.stack([x, x + 1]))
    assert d[0] == pytest.approx(0)
    assert d[1] > 0


def test_twin_search_returns_three_other_valid_countries(twin_index):
    result = twin_index.find("LBY")
    countries = {t["iso3"] for t in result["twins"]}
    assert len(countries) == 3
    assert "LBY" not in countries
    assert countries <= set(twin_index.iso3)
    for t in result["twins"]:
        assert 0 < t["similarity"] <= 100
        assert len(t["access"]) == 11  # matched year + 10 years after
    sims = [t["similarity"] for t in result["twins"]]
    assert sims == sorted(sims, reverse=True)


def test_twins_are_within_one_order_of_magnitude_in_population(twin_index):
    for iso3 in ["LBY", "NGA", "IRQ", "CAN", "NOR"]:
        r = twin_index.find(iso3)
        for t in r["twins"]:
            ratio = t["population_then"] / r["population_now"]
            assert 0.1 <= ratio <= 10, (iso3, t["country"], ratio)


# ---------- Plan and futures ----------

def test_revenue_scenarios_shape_and_positive():
    f = model.revenue_scenarios("LBY", n=200)
    assert f.shape == (200, model.YEARS)
    assert (f > 0).all()


# ---------- Signature facts ----------

def test_signatures_differ_between_countries():
    texts = {iso: tuple(f["text"] for f in signature.signature(iso)) for iso in ["LBY", "NGA", "NOR", "CHL", "IDN"]}
    assert len(set(texts.values())) == 5
    assert all(1 <= len(t) <= 3 for t in texts.values())


def test_main_resource_detection():
    assert model.main_resource("LBY") == "oil"
    assert model.main_resource("CHL") == "minerals"


# ---------- Electrification planner ----------

def _plan(iso3):
    import electric

    a = electric.params(iso3=iso3)
    b = electric.budget(iso3, a)
    return electric, a, electric.context(iso3, a), b


def test_recommendation_always_funds_grid_and_follows_resources():
    import electric

    for iso3 in ["NGA", "BEN", "KEN", "COD", "BWA"]:
        _, a, ctx, b = _plan(iso3)
        rec = electric.recommend(iso3, a, b["total"])
        assert sum(rec["split"].values()) == 100
        assert rec["split"]["grid"] >= electric.MIN_GRID
        if ctx["wind"] < 5.0:
            assert rec["split"]["wind"] == 0, iso3
        assert "baseload" not in rec["banner"]


def test_recommendation_changes_with_resource_data():
    import electric

    _, a, _, b = _plan("NGA")
    weak = electric.params({"wind_threshold": 9.0}, "KEN")
    strong = electric.params({"wind_threshold": 4.0}, "KEN")
    bk = electric.budget("KEN", weak)["total"]
    assert electric.recommend("KEN", strong, bk)["split"]["wind"] > electric.recommend("KEN", weak, bk)["split"]["wind"]


def test_access_is_capped_and_needs_both_lines_and_generation():
    electric, a, ctx, b = _plan("NGA")
    ones = np.ones((1, electric.YEARS))
    full = electric.simulate(ctx, a, b["total"], {"solar": 30, "wind": 10, "grid": 60}, ones)
    assert (full["access_pct"] <= 100).all() and (full["clean_pct"] <= 100).all()
    no_grid = electric.simulate(ctx, a, b["total"], {"solar": 100, "wind": 0, "grid": 0}, ones)
    assert no_grid["access_pct"][0, -1] == pytest.approx(ctx["access0"])  # generation without delivery connects no one
    no_gen = electric.simulate(ctx, a, b["total"], {"solar": 0, "wind": 0, "grid": 100}, ones)
    assert no_gen["access_pct"][0, -1] == pytest.approx(ctx["access0"])  # lines without power connect no one


def test_shocks_never_improve_the_plan():
    electric, a, ctx, b = _plan("BEN")
    split = electric.recommend("BEN", a, b["total"])["split"]
    base = electric.simulate(ctx, a, b["total"], split, np.ones((1, electric.YEARS)))["access_pct"][0, -1]
    for name in electric.SHOCKS:
        si = electric.shock_inputs(name)
        after = electric.simulate(ctx, a, b["total"], split, si["factor"], si["capex_mult"], si["extra_delay"])["access_pct"][0, -1]
        assert after <= base + 1e-9, name


def test_budget_parts_add_up():
    _, a, _, b = _plan("NGA")
    assert b["total"] == pytest.approx(b["gdp"]["amount"] + b["resource"]["amount"])
    assert b["gdp"]["amount"] == pytest.approx(b["gdp"]["base"] * a["budget_gdp_share"])


def test_peers_meet_the_selection_rule():
    from ml.twins import ELECTRIC_FEATURES, PEER_BAND, TwinIndex, load_panel

    ix = TwinIndex.build(load_panel(), ELECTRIC_FEATURES)
    for iso3 in ["NGA", "BEN", "CMR", "COD"]:
        out = ix.find_peers(iso3)
        for p in out["peers"]:
            start, end = p["access"][0], p["access"][-1]
            assert p["iso3"] != iso3
            assert abs(start - out["access_now"]) <= PEER_BAND
            assert start < 95
            assert end - start >= 10 or end >= 95
