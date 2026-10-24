"""The impact model's forecasts are bounded and its SHAP explanation adds up in percentage points."""

import json
from pathlib import Path

import joblib
import pandas as pd
import pytest
import shap

from ml import impact

MODELS = Path(__file__).resolve().parent.parent / "ml" / "models"


@pytest.fixture(scope="module")
def trained():
    model = joblib.load(MODELS / "impact.joblib")
    latest = pd.read_csv(MODELS / "latest_features.csv").set_index("iso3")
    return model, shap.TreeExplainer(model), latest


def test_shap_adds_up_in_points(trained):
    """Baseline + sum of factors = prediction (before bounding), for every country."""
    model, explainer, latest = trained
    for iso3 in latest.index:
        o = impact.explain(model, explainer, latest.loc[[iso3]])
        total = o["baseline_pts"] + sum(f["effect"] for f in o["factors"])
        assert total == pytest.approx(o["raw_change"], abs=1e-6), iso3
        if not o["clipped"]:
            assert total == pytest.approx(o["change"], abs=1e-6), iso3


def test_predictions_are_bounded(trained):
    model, explainer, latest = trained
    for iso3 in latest.index:
        o = impact.explain(model, explainer, latest.loc[[iso3]])
        assert 0 <= o["access_in_10"] <= 100, iso3
        assert o["change"] >= 0, iso3


def test_no_gap_means_no_change(trained):
    model, explainer, latest = trained
    full = latest[latest.electricity_access_pct >= impact.NO_GAP].index
    assert len(full) > 0
    for iso3 in full:
        o = impact.explain(model, explainer, latest.loc[[iso3]])
        assert o["no_gap"] and o["change"] == 0 and o["baseline_pts"] == 0, iso3


def test_saved_projections_are_bounded():
    proj = json.loads((MODELS / "projections.json").read_text())
    assert all(0 <= p["to"] <= 100 and p["to"] >= p["from"] - 1e-9 for p in proj.values())


def test_metrics_are_reported_both_ways():
    m = json.loads((MODELS / "metrics.json").read_text())
    for key in ["all", "under_95"]:
        assert {"mae", "baseline_mae", "error_reduction", "r2", "rows"} <= set(m[key])
