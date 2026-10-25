"""Impact model: how much of a country's remaining electricity gap closes over the next 10 years.

Target: share of the gap closed, (access in 10 years − access now) / (100 − access now), bounded 0–1.
Predictions convert back to percentage points by multiplying by the country's gap, so a forecast can
never exceed 100% or fall below 0%, and a country already at 100% is predicted exactly 0 change.
Declines are rare and treated as "no progress" (the share of training windows affected is reported).

Honest evaluation: train on starting years up to 2003 (outcomes by 2013), test on starting years
2013-2015 (outcomes 2023-2025). No test input year overlaps any training outcome."""

import numpy as np
import pandas as pd
import shap
from lightgbm import LGBMRegressor
from sklearn.metrics import mean_absolute_error, r2_score

HORIZON = 10
TRAIN_LAST_START = 2003
TEST_STARTS = (2013, 2014, 2015)
NO_GAP = 99.95  # at or above this, there is no gap left to close
UNDER_95 = 95.0

FEATURES = [
    "electricity_access_pct", "access_change_5y", "oil_rents_pct_gdp", "log_gdp_per_capita",
    "renewable_electricity_pct", "urban_pct", "log_population", "investment_pct_gdp",
]
LABELS = {
    "electricity_access_pct": "How many already have power",
    "access_change_5y": "5-year connection trend",
    "oil_rents_pct_gdp": "Oil share of the economy",
    "log_gdp_per_capita": "Income per person",
    "renewable_electricity_pct": "Clean electricity share",
    "urban_pct": "Share of people in cities",
    "log_population": "Population size",
    "investment_pct_gdp": "How much the country invests",
}


def build_dataset(panel: pd.DataFrame) -> pd.DataFrame:
    p = panel.sort_values(["iso3", "year"]).copy()
    p["log_gdp_per_capita"] = np.log10(p.gdp_per_capita_usd)
    p["log_population"] = np.log10(p.population)
    rows = []
    for iso3, g in p.groupby("iso3"):
        g = g.set_index("year")
        for t in g.index:
            if not g.loc[t, "access_observed"]:
                continue
            row = {f: g.loc[t, f] for f in FEATURES if f in g.columns}
            row["access_change_5y"] = g.loc[t, "electricity_access_pct"] - g.loc[t - 5, "electricity_access_pct"] if t - 5 in g.index else np.nan
            later = t + HORIZON
            row["change_pts"] = (g.loc[later, "electricity_access_pct"] - g.loc[t, "electricity_access_pct"]
                                 if later in g.index and g.loc[later, "access_observed"] else np.nan)
            rows.append({"iso3": iso3, "year": t, **row})
    df = pd.DataFrame(rows)
    df["gap"] = (100 - df.electricity_access_pct).clip(lower=0)
    has_gap = df.electricity_access_pct < NO_GAP
    df["share_closed"] = np.where(has_gap, df.change_pts / df.gap.where(has_gap), np.nan)
    df["declined"] = df.change_pts < 0
    df["share_closed"] = df.share_closed.clip(0, 1)
    return df


def make_model() -> LGBMRegressor:
    return LGBMRegressor(n_estimators=400, learning_rate=0.03, num_leaves=15, min_child_samples=20,
                         subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=0, verbose=-1)


def trainable(df: pd.DataFrame) -> pd.DataFrame:
    """Rows with a measured outcome and a gap to close."""
    return df.dropna(subset=["change_pts"])[lambda d: d.electricity_access_pct < NO_GAP]


def predict_pts(model: LGBMRegressor, rows: pd.DataFrame) -> np.ndarray:
    """Predicted 10-year change in percentage points: bounded share × gap; 0 where there is no gap."""
    share = np.clip(model.predict(rows[FEATURES]), 0, 1)
    return np.where(rows.electricity_access_pct < NO_GAP, share * rows.gap, 0.0)


def scores(actual: np.ndarray, pred: np.ndarray) -> dict:
    mae = float(mean_absolute_error(actual, pred))
    base = float(mean_absolute_error(actual, np.zeros(len(actual))))
    return {"rows": int(len(actual)), "mae": mae, "baseline_mae": base,
            "error_reduction": float(1 - mae / base) if base else 0.0, "r2": float(r2_score(actual, pred))}


def evaluate(df: pd.DataFrame) -> dict:
    labeled = df.dropna(subset=["change_pts"])
    train = trainable(labeled[labeled.year <= TRAIN_LAST_START])
    test = labeled[labeled.year.isin(TEST_STARTS)]
    model = make_model().fit(train[FEATURES], train.share_closed)
    pred = predict_pts(model, test)
    under = (test.electricity_access_pct < UNDER_95).to_numpy()
    return {
        "train_rows": int(len(train)), "test_rows": int(len(test)),
        "train_years": f"{int(train.year.min())}–{TRAIN_LAST_START}", "test_years": f"{TEST_STARTS[0]}–{TEST_STARTS[-1]}",
        "all": scores(test.change_pts.to_numpy(), pred),
        "under_95": scores(test.change_pts.to_numpy()[under], pred[under]),
        "declines_share": float(trainable(labeled).declined.mean()),
        "target": "share of the remaining electricity gap closed in 10 years (0–1)",
    }


def train_final(df: pd.DataFrame) -> LGBMRegressor:
    """After testing, the deployed model learns from every labeled row with a gap to close."""
    rows = trainable(df)
    return make_model().fit(rows[FEATURES], rows.share_closed)


def explain(model: LGBMRegressor, explainer: shap.TreeExplainer, row: pd.DataFrame) -> dict:
    """Forecast for one country with SHAP values converted to percentage points.
    In points: baseline + sum(factors) = prediction, exactly, unless the raw share fell outside 0–1."""
    access = float(row.electricity_access_pct.iloc[0])
    gap = max(0.0, 100 - access)
    if access >= NO_GAP:
        return {"access_now": access, "gap": 0.0, "baseline_pts": 0.0, "change": 0.0, "access_in_10": access,
                "raw_change": 0.0, "clipped": False, "no_gap": True,
                "factors": [{"label": LABELS[f], "value": None if pd.isna(row[f].iloc[0]) else float(row[f].iloc[0]), "effect": 0.0} for f in FEATURES]}
    x = row[FEATURES]
    raw = float(model.predict(x)[0])
    values = explainer.shap_values(x)[0]
    base = float(np.ravel(explainer.expected_value)[0])
    share = min(1.0, max(0.0, raw))
    return {
        "access_now": access, "gap": gap,
        "baseline_pts": base * gap,  # what the model predicts for an average country, applied to this gap
        "raw_change": raw * gap,  # baseline + factors, before bounding
        "change": share * gap, "access_in_10": access + share * gap,
        "clipped": raw != share, "no_gap": False,
        "factors": sorted(({"label": LABELS[f], "value": None if pd.isna(x[f].iloc[0]) else float(x[f].iloc[0]),
                            "effect": float(v * gap)} for f, v in zip(FEATURES, values)), key=lambda d: -abs(d["effect"])),
    }
