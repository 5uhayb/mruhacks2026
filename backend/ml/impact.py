"""Impact model: predicts how much electricity access changes over the next 10 years from a country's
starting profile. Gradient-boosted trees (LightGBM), explained with SHAP.

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

FEATURES = [
    "electricity_access_pct", "access_change_5y", "oil_rents_pct_gdp", "log_gdp_per_capita",
    "renewable_electricity_pct", "urban_pct", "log_population", "investment_pct_gdp",
]
LABELS = {
    "electricity_access_pct": "Electricity access today",
    "access_change_5y": "Change in access over the last 5 years",
    "oil_rents_pct_gdp": "Oil share of the economy",
    "log_gdp_per_capita": "Income per person",
    "renewable_electricity_pct": "Clean electricity share",
    "urban_pct": "Share living in cities",
    "log_population": "Population size",
    "investment_pct_gdp": "Investment, % of GDP",
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
            row["target"] = (g.loc[later, "electricity_access_pct"] - g.loc[t, "electricity_access_pct"]
                             if later in g.index and g.loc[later, "access_observed"] else np.nan)
            rows.append({"iso3": iso3, "year": t, **row})
    return pd.DataFrame(rows)


def make_model() -> LGBMRegressor:
    return LGBMRegressor(n_estimators=400, learning_rate=0.03, num_leaves=15, min_child_samples=20,
                         subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=0, verbose=-1)


def evaluate(df: pd.DataFrame) -> dict:
    labeled = df.dropna(subset=["target"])
    train = labeled[labeled.year <= TRAIN_LAST_START]
    test = labeled[labeled.year.isin(TEST_STARTS)]
    model = make_model().fit(train[FEATURES], train.target)
    pred = model.predict(test[FEATURES])
    return {
        "train_rows": len(train), "test_rows": len(test),
        "train_years": f"{int(train.year.min())}–{TRAIN_LAST_START}",
        "test_years": f"{TEST_STARTS[0]}–{TEST_STARTS[-1]}",
        "r2": float(r2_score(test.target, pred)),
        "mae": float(mean_absolute_error(test.target, pred)),
        "baseline_no_change_mae": float(mean_absolute_error(test.target, np.zeros(len(test)))),
        "baseline_average_mae": float(mean_absolute_error(test.target, np.full(len(test), train.target.mean()))),
    }


def train_final(df: pd.DataFrame) -> LGBMRegressor:
    """After testing, the deployed model learns from every labeled row."""
    labeled = df.dropna(subset=["target"])
    return make_model().fit(labeled[FEATURES], labeled.target)


def explain(model: LGBMRegressor, df: pd.DataFrame, iso3: str) -> dict:
    rows = df[df.iso3 == iso3]
    row = rows[rows.year == rows.year.max()]
    x = row[FEATURES]
    pred = float(model.predict(x)[0])
    now = float(row.electricity_access_pct.iloc[0])
    explainer = shap.TreeExplainer(model)
    values = explainer.shap_values(x)[0]
    factors = sorted(
        ({"feature": f, "label": LABELS[f], "value": None if pd.isna(x[f].iloc[0]) else float(x[f].iloc[0]), "effect": float(v)}
         for f, v in zip(FEATURES, values)),
        key=lambda d: -abs(d["effect"]),
    )
    return {
        "year": int(row.year.iloc[0]), "access_now": now,
        "predicted_change": pred, "predicted_access": float(min(100.0, max(0.0, now + pred))),
        "baseline": float(np.ravel(explainer.expected_value)[0]), "factors": factors,
    }
