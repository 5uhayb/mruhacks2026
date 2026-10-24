# Nahda (نهضة)

**MRUHacks 2026 · Theme: Revitalize**

A planning workspace for countries that earn a lot from natural resources but have fallen behind. Pick any country on a 3D globe and see where it stands, what history suggests if nothing changes, what investing part of its resource income in solar, rail and a savings fund could build, and whether that plan survives bad years.

**Start:** double-click `start.bat` (opens http://localhost:5173), or run the two servers below.

## The workspace

The globe is the app. Click a country (or press **Ctrl K** to search) and a panel opens beside it:

| Tab | What it shows |
|---|---|
| Profile | The country's 2–3 most distinctive facts, chosen automatically from world percentiles and 20-year changes |
| Twins | Countries that were once on a similar path, and what happened to them next; side by side with the impact model |
| Plan | Invest a share of resource income; drag the split between solar, rail and savings; results by year 10 |
| Stress | Single shocks (before/after) and 500 futures built from the country's own income history |
| Model | Why the model predicts what it does (SHAP), its accuracy, and the full pipeline |

The timeline at the bottom recolors every country by electricity access from 1990 to 10 years ahead (projected years tinted gold; the selected country follows your plan). Press **`** for the System log of live API calls with timings. **Export brief** produces a one-page Markdown/PDF summary from the current state. Search lists **Revitalization targets** first (rule in the tooltip).

## Models (honest numbers)

| | Method | Result |
|---|---|---|
| Impact model | LightGBM predicting the share of the remaining electricity gap closed in 10 years (bounded 0–1), explained with SHAP in percentage points | Trained on start years 1990–2003, tested on 2013–2015 (no overlap). All countries: MAE 3.1 pts vs 6.5 for "no change", R² 0.62. Below 95% access: MAE 7.3 pts vs 15.2, R² 0.22 |
| Twins | Dynamic time warping over 5-year paths of 6 standardized indicators; twins within 10× in population | Best match per country, weighted forecast with range |
| Optimizer | Grid search over solar/rail/savings splits | Fastest electricity access, with ≥90% of planned spending happening in ≥80% of futures |
| Stress test | Block bootstrap (3-year blocks) of the country's own resource-income changes | 500 futures |

The impact model cannot predict declines (access fell in 3.6% of training windows; treated as no progress).

## Run it (two terminals)

```
cd backend
python -m uvicorn main:app --port 8000
```

```
cd frontend
npm.cmd run dev
```

Setup on a new machine: `pip install -r backend/requirements.txt`, then `npm install` in `frontend/`. Data and trained models are cached locally; nothing calls an external service at runtime. Refresh data with `python fetch_data.py`, retrain with `python -m ml.train` (prints accuracy).

## Tests

- Backend: `cd backend && python -m pytest` (19 tests: solar output, IRR/NPV/payback, Libya payback 5–9 years, DTW, twins validity and population limit, money conservation, optimizer constraint, households cap and consistency with clean share, SHAP adds up in points, bounded predictions, signatures differ, resource detection)
- Frontend: `cd frontend && npm test` (9 tests: number formatting)

## Structure

```
backend/   main.py (FastAPI, typed Pydantic responses), model.py (plan, solar, rail, futures), signature.py (country facts),
           notes.py, ml/ (twins.py, impact.py, optimize.py, train.py, models/), tests/, fetch_data.py, data/
frontend/  React + TypeScript + Tailwind + react-globe.gl + Recharts; src/lib/format.ts is the only number formatter
```

## Data

World Bank (WDI bulk files, all countries, 1990–2025; each value shown with its latest available year), NASA POWER sunlight, Natural Earth outlines. Gas and forest rents were unavailable from the World Bank at build time, so they are derived together as total rents minus oil, minerals and coal.

## Limitations

New power is assumed to reach homes through the grid (transmission and connections not modelled); storage is not costed; rail benefits are not modelled; household sizes are approximate regional averages (editable); governance and fuel-subsidy effects are described, not modelled.

Illustrative planning model built on public data. Not investment advice.
