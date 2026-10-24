# Nahda (نهضة)

**MRUHacks 2026 · Theme: Revitalize**

**A pre-feasibility and capital allocation tool** for development finance institutions (DFIs), NGOs and trade organizations: see what a country's own resource income could fund, what each sector returns, and what macro trade-offs it creates.

Pick any country on a 3D globe and see where it stands, what similar countries did differently, how a share of its resource income could be split across power, transport, tourism & industry and a savings fund, what each sector returns, what a gradual fuel price reform would free up (and cost in inflation), and whether the plan survives bad years. It describes scenarios; it does not tell any government what to do.

**Start:** double-click `start.bat` (opens http://localhost:5173), or run the two servers below.

## The workspace

The globe is the app. Click a country (or press **Ctrl K** to search) and a panel opens beside it:

| Tab | What it shows |
|---|---|
| Profile | The country's 2–3 most distinctive facts, chosen automatically from world percentiles and 20-year changes |
| Twins | Peer playbook: the 3 closest historical peers, each badged Turnaround or Stagnated by a data rule, in 3 lines (match, biggest change, result). "Use [Peer]'s playbook →" sets the plan split from the best turnaround peer with a documented heuristic. Click a peer for a full comparison |
| Plan | Invest a share of resource income; instant presets (Peer Playbook, Balanced, Power, Mobility, Growth; each sector 10–50%, precomputed and cached per country); four sectors each show capital deployed, yearly return and payback; optional fuel price reform (freed subsidy, inflation, net household cost after rebates) and solar sourcing (Tier-1 OEM import vs local assembly JV) |
| Stress | 500 historical bootstrap futures first; single macro shocks behind a toggle |
| Model | Supervised learning: LightGBM trained on the country panel, SHAP explanation, honest out-of-sample accuracy |

Countries are colored by electricity access tier (red below 60% critical, amber 60–90% struggling, slate 90%+ connected), with offline SVG flags. **Ask Nahda** (bottom right) answers questions through the backend (`POST /api/advisor`): Gemini with Google Search grounding, then Gemini without search, then Claude if `ANTHROPIC_API_KEY` is set, then an offline answer from app data; keys stay in `backend/.env`. The timeline at the bottom recolors every country by electricity access from 1990 to 10 years ahead (projected years tinted gold; the selected country follows your plan). Press **`** for the hidden System log of live API calls with timings. **Pre-feasibility brief** produces a one-page Markdown/PDF summary from the current state. Search lists **Revitalization targets** first (rule in the tooltip).

## Models (honest numbers)

| | Method | Result |
|---|---|---|
| Impact model | LightGBM predicting the share of the remaining electricity gap closed in 10 years (bounded 0–1), explained with SHAP in percentage points | Trained on start years 1990–2003, tested on 2013–2015 (no overlap). All countries: MAE 3.1 pts vs 6.5 for "no change", R² 0.62. Below 95% access: MAE 7.3 pts vs 15.2, R² 0.22 |
| Twins | Dynamic time warping over 5-year paths of 6 standardized indicators; twins within 10× in population | Best match per country, weighted forecast with range |
| Optimizer | Grid search over 4-sector splits (5% then 1% steps), one objective weight set per preset | Power = fastest access; Mobility = rail corridor; Growth = non-oil returns (rail + tourism & industry; solar's return is still oil income); Resilience = savings; Balanced = all four equally, each sector ≥10%. Always ≥90% of planned spending in ≥80% of futures |
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

- Backend: `cd backend && python -m pytest` (24 tests: four-sector costs/returns/payback, Balanced funds all four, rebates change household cost but not inflation, rail freight relief only after the corridor is complete, twin differences from data, solar output, IRR/NPV/payback, Libya payback 5–9 years, DTW, twins validity and population limit, money conservation, optimizer constraint, households cap and consistency with clean share, SHAP adds up in points, bounded predictions, signatures differ, resource detection)
- Frontend: `cd frontend && npm test` (9 tests: number formatting)

## Structure

```
backend/   main.py (FastAPI, typed Pydantic responses), model.py (plan, solar, rail, futures), signature.py (country facts),
           notes.py, ml/ (twins.py, impact.py, optimize.py, train.py, models/), tests/, fetch_data.py, data/
frontend/  React + TypeScript + Tailwind + react-globe.gl + Recharts; src/lib/format.ts is the only number formatter
```

## Data

World Bank (WDI bulk files, all countries, 1990–2025; each value shown with its latest available year), NASA POWER sunlight, Natural Earth outlines. Twin comparisons and the fuel reform use extra World Bank indicators (NE.GDI.FTOT.ZS, BX.KLT.DINV.WD.GD.ZS, NV.IND.MANF.ZS, TX.VAL.FUEL.ZS.UN, NE.CON.PRVT.CD, EG.USE.PCAP.KG.OE; `python fetch_data.py --trade-only`); missing values show as "no data". Gas and forest rents were unavailable from the World Bank at build time, so they are derived together as total rents minus oil, minerals and coal.

## Estimates vs data

Rail and tourism & industry returns, solar sourcing premiums and jobs, and the fuel reform parameters are editable planning assumptions, labelled "(estimate)" in the app. The current pump price is a generic placeholder to set per country (the World Bank pump-price file did not match known prices, so it is not used). Fuel use per person defaults to World Bank energy use per person × a road-fuel share (estimate). Household spending for the inflation estimate is World Bank NE.CON.PRVT.CD where available.

## Limitations

New power is assumed to reach homes through the grid (transmission and connections not modelled); storage is not costed; rail benefits are not modelled; household sizes are approximate regional averages (editable); governance is described, not modelled; the fuel reform ignores changes in how much fuel people buy.

Illustrative planning model built on public data. Not investment advice.
