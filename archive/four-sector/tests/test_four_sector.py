"""Archived tests for the four-sector plan (not collected; restore with the archived backend)."""

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
