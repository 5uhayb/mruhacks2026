"""Tests for the core calculations. Run from backend/: python -m pytest"""

import numpy as np
import pytest

import model
import signature
from ml import optimize
from ml.twins import TwinIndex, dtw_batch, load_panel


@pytest.fixture(scope="module")
def twin_index():
    return TwinIndex.build(load_panel())


# ---------- Solar ----------

def test_solar_output_matches_formula():
    """Annual MWh = MW × sunlight (kWh/m²/day) × 365 × performance ratio."""
    a = model.params()
    f = model.solar_flows(a, solar_kwh=6.0, mw=500)
    assert f["mwh"] == pytest.approx(500 * 6.0 * 365 * 0.8)
    assert f["capex"] == pytest.approx(500 * 800_000)
    assert len(f["flows"]) == 1 + int(a["project_life"])


def test_libya_solar_payback_is_plausible():
    """Base-case payback at every Libyan site should land between 5 and 9 years."""
    a = model.params()
    for site in model.sites_for("LBY").site:
        payback = model.deal("LBY", site, 500, a)["payback"]
        assert 5 <= payback <= 9, site


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
    p = model.params({"solar_capex_per_mw": 1, "fuel_value": 999})
    assert p["solar_capex_per_mw"] == model.ASSUMPTIONS["solar_capex_per_mw"]["min"]
    assert p["fuel_value"] == model.ASSUMPTIONS["fuel_value"]["max"]


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


def test_simulation_conserves_money():
    """Money spent on projects plus what is in the fund never exceeds the money put in plus returns."""
    a = model.params()
    ctx = model.context("LBY", a)
    r = model.simulate(ctx, a, 0.1, {"solar": 40, "rail": 30, "fund": 30}, 6.5, np.ones((1, model.YEARS)))
    put_in = r["pool"].sum()
    spent = r["solar_spend"].sum() + r["rail_spend"].sum()
    assert spent + r["fund"][0, -1] <= put_in + r["fund_returns"].sum() + 1


def test_optimizer_respects_funding_rule():
    a = model.params()
    ctx = model.context("NGA", a)
    best = optimize.best_plan(ctx, a, 0.1, 6.0, model.revenue_scenarios("NGA", 300))
    assert best["p_funded"] >= optimize.MIN_FUNDED
    assert sum(best["split"].values()) == pytest.approx(100, abs=2)


# ---------- Signature facts ----------

def test_signatures_differ_between_countries():
    texts = {iso: tuple(f["text"] for f in signature.signature(iso)) for iso in ["LBY", "NGA", "NOR", "CHL", "IDN"]}
    assert len(set(texts.values())) == 5
    assert all(1 <= len(t) <= 3 for t in texts.values())


def test_main_resource_detection():
    assert model.main_resource("LBY") == "oil"
    assert model.main_resource("CHL") == "minerals"
