"""Train the impact model once and save it. Run from backend/: python -m ml.train"""

import json
import time
from pathlib import Path

import joblib

from ml import impact, twins

OUT = Path(__file__).resolve().parent / "models"


def main():
    OUT.mkdir(exist_ok=True)
    start = time.time()
    panel = twins.load_panel()
    print(f"Panel: {panel.iso3.nunique()} countries, {len(panel)} country-years, {panel.year.min()}–{panel.year.max()}")

    print(f"\nImpact model (LightGBM): {impact.trainable(impact.build_dataset(panel)).shape[0]} labeled windows")
    df = impact.build_dataset(panel)
    metrics = impact.evaluate(df)
    print(f"  target: {metrics['target']}")
    print(f"  train: {metrics['train_rows']} rows (start years {metrics['train_years']})")
    print(f"  test:  {metrics['test_rows']} rows (start years {metrics['test_years']})")
    print(f"  declines treated as no progress: {metrics['declines_share']:.1%} of training windows")
    for key, name in [("all", "All countries"), ("under_95", "Below 95% access at start")]:
        s = metrics[key]
        print(f"  {name} ({s['rows']} rows): MAE {s['mae']:.2f} pts · no-change baseline {s['baseline_mae']:.2f} · "
              f"{s['error_reduction']:.0%} lower error · R² {s['r2']:.3f}")
    model = impact.train_final(df)
    joblib.dump(model, OUT / "impact.joblib")

    # Latest profile of every country, plus its "no plan" projection for the globe's time scrubber
    latest = df.sort_values("year").groupby("iso3").tail(1).reset_index(drop=True)
    latest.to_csv(OUT / "latest_features.csv", index=False)
    pred = impact.predict_pts(model, latest)
    projections = {
        r.iso3: {"from_year": int(r.year), "from": float(r.electricity_access_pct),
                 "to": float(r.electricity_access_pct + p)}
        for r, p in zip(latest.itertuples(), pred)
    }
    assert all(0 <= v["to"] <= 100 for v in projections.values()), "projection out of bounds"
    (OUT / "projections.json").write_text(json.dumps(projections))
    print(f"  projections saved for {len(projections)} countries")
    metrics.update({"countries": int(panel.iso3.nunique()), "rows": int(len(panel)),
                    "first_year": int(panel.year.min()), "last_year": int(panel.year.max())})
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=1))

    print("\nComeback Finder (DTW twins), sample countries")
    index = twins.TwinIndex.build(panel)
    print(f"  {len(index.windows)} searchable 5-year windows")
    for iso3 in ["LBY", "NGA", "NOR", "CHL", "IDN"]:
        t = index.find(iso3)
        print(f"  {iso3}: " + ", ".join(f"{x['country']} {x['year']} ({x['similarity']:.0f}%)" for x in t["twins"]))
    print(f"\nSaved to {OUT} in {time.time() - start:.0f}s")


if __name__ == "__main__":
    main()
