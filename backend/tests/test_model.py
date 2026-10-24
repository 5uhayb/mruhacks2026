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
    r = model.simulate(ctx, a, 0.1, {"solar": 35, "rail": 20, "industry": 15, "fund": 30}, 6.5, np.ones((1, model.YEARS)))
    put_in = r["pool"].sum()
    spent = r["solar_spend"].sum() + r["rail_spend"].sum() + r["industry_spend"].sum()
    assert spent + r["fund"][0, -1] <= put_in + r["fund_returns"].sum() + 1


def test_presets_respect_bounds_and_funding_rule():
    """Every preset keeps each sector within 10-50% and stays funded in at least 80% of futures."""
    a = model.params(iso3="NGA")
    ctx = model.context("NGA", a)
    out = optimize.all_presets(ctx, a, 0.1, 6.0, model.revenue_scenarios("NGA", 300))
    for key, p in out["presets"].items():
        assert sum(p["split"].values()) == pytest.approx(100, abs=1), key
        assert all(10 <= v <= 50 for v in p["split"].values()), key
        assert p["p_funded"] >= optimize.MIN_FUNDED, key


# ---------- Signature facts ----------

def test_signatures_differ_between_countries():
    texts = {iso: tuple(f["text"] for f in signature.signature(iso)) for iso in ["LBY", "NGA", "NOR", "CHL", "IDN"]}
    assert len(set(texts.values())) == 5
    assert all(1 <= len(t) <= 3 for t in texts.values())


def test_main_resource_detection():
    assert model.main_resource("LBY") == "oil"
    assert model.main_resource("CHL") == "minerals"


def test_homes_powered_never_exceeds_households():
    """Above 100% coverage the app must say 'every home' and cap the count at the number of households."""
    import main

    for iso3 in ["LBY", "NGA", "IRQ", "CAN", "NOR"]:
        for share in [0.02, 0.1, 0.3]:
            a = model.params(iso3=iso3)
            ctx = model.context(iso3, a)
            r = model.simulate(ctx, a, share, {"solar": 60, "rail": 20, "fund": 20},
                               float(model.sites_for(iso3).iloc[0].solar_kwh_m2_day), np.ones((1, model.YEARS)))
            y = model.rows(r)[-1]
            h = main.homes_summary(ctx, y)
            assert h["homes_powered"] <= h["households"] + 1e-6, iso3
            assert h["every_home"] == (y["household_coverage"] >= 1), iso3
            # Homes and clean share use the same generation and the same national demand
            clean_added = y["renewable_pct"] - ctx["renew0"]
            if y["renewable_pct"] < 100:
                assert clean_added == pytest.approx(y["household_coverage"] * a["residential_share"] * 100, rel=1e-6), iso3


# ---------- Four sectors, presets, fuel reform, twins ----------

def test_every_sector_reports_cost_return_and_payback():
    a = model.params(iso3="LBY")
    ctx = model.context("LBY", a)
    r = model.simulate(ctx, a, 0.1, {"solar": 25, "rail": 25, "industry": 25, "fund": 25}, 6.5, np.ones((1, model.YEARS)))
    econ = model.sector_economics(a, r, 6.5)
    assert set(econ) == set(model.SECTORS)
    for k in ["solar", "rail", "industry"]:
        assert econ[k]["capex"] > 0 and econ[k]["annual_return"] > 0 and econ[k]["payback"] > 0, k
    assert econ["fund"]["annual_return"] > 0
    # Rail pays nothing before any track is open
    assert r["rail_value"][0, : int(a["rail_build_years"])].sum() == 0


def test_peer_playbook_stays_in_bounds(twin_index):
    import differences

    t = twin_index.find("LBY")
    base = {"solar": 20, "rail": 40, "industry": 10, "fund": 30}
    for tw in t["twins"]:
        pb = differences.playbook(tw, base, 6.5, t["access_now"])
        assert sum(pb["split"].values()) == 100
        assert all(10 <= v <= 50 for v in pb["split"].values())
        assert pb["explanation"].startswith(f"Based on {tw['country']} {tw['year']}")


def test_rebates_lower_household_cost_not_inflation():
    a = model.params(iso3="LBY")
    ctx = model.context("LBY", a)
    none = np.zeros(model.YEARS)
    low = model.fuel_reform("LBY", ctx, a, 0.6, 5, 0.0, none)
    high = model.fuel_reform("LBY", ctx, a, 0.6, 5, 0.8, none)
    assert low["cpi"] == pytest.approx(high["cpi"])
    assert high["net_per_home_month"][-1] < low["net_per_home_month"][-1]


def test_rail_relief_only_after_corridor_is_complete():
    a = model.params(iso3="LBY")
    ctx = model.context("LBY", a)
    done = np.array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1], dtype=float)
    without = model.fuel_reform("LBY", ctx, a, 0.6, 5, 0.5, np.zeros(model.YEARS))
    withrail = model.fuel_reform("LBY", ctx, a, 0.6, 5, 0.5, done)
    assert withrail["cpi"][:6] == pytest.approx(without["cpi"][:6])
    assert withrail["cpi"][6] < without["cpi"][6]


def test_twin_differences_come_from_data(twin_index):
    import differences

    t = twin_index.find("IRQ")
    tw = t["twins"][0]
    out = differences.compare("IRQ", "Iraq", t["year"], tw["iso3"], tw["country"], tw["year"])
    assert 1 <= len(out["differences"]) <= 3
    for r in out["rows"]:
        if r["twin"]["from"] is not None:
            assert r["twin"]["from_year"] < r["twin"]["to_year"]
