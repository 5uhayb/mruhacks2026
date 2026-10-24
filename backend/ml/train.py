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

    print("\nImpact model (LightGBM): 10-year change in electricity access")
    df = impact.build_dataset(panel)
    metrics = impact.evaluate(df)
    print(f"  train: {metrics['train_rows']} rows (start years {metrics['train_years']})")
    print(f"  test:  {metrics['test_rows']} rows (start years {metrics['test_years']})")
    print(f"  test R²:  {metrics['r2']:.3f}")
    print(f"  test MAE: {metrics['mae']:.2f} percentage points")
    print(f"  baseline MAE, predict no change:   {metrics['baseline_no_change_mae']:.2f}")
    print(f"  baseline MAE, predict the average: {metrics['baseline_average_mae']:.2f}")
    model = impact.train_final(df)
    joblib.dump(model, OUT / "impact.joblib")

    # Latest profile of every country, plus its "no plan" projection for the globe's time scrubber
    latest = df.sort_values("year").groupby("iso3").tail(1).reset_index(drop=True)
    latest.to_csv(OUT / "latest_features.csv", index=False)
    pred = model.predict(latest[impact.FEATURES])
    projections = {
        r.iso3: {"from_year": int(r.year), "from": float(r.electricity_access_pct),
                 "to": float(min(100, max(0, r.electricity_access_pct + p)))}
        for r, p in zip(latest.itertuples(), pred)
    }
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
