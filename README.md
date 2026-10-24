# Nahda (نهضة) — Electrification planner

**MRUHacks 2026 · Theme: Revitalize**

Match under-connected countries with peers that closed their electricity gap. Nahda helps countries below 90% electricity access plan how to close it: it finds historical peers that succeeded and recommends a solar / wind / grid & storage mix from each country's real sun and wind data.

**Start:** double-click `start.bat` (opens http://localhost:5173). To share a public link, double-click `share.bat`.

## The workspace

The globe colors every country by electricity access (red below 60% critical, amber 60–90% struggling, slate 90%+ connected, grey no data), with the data year in the legend. Quick-pick chips under the search show the 5 countries below 90% access with the best data coverage, chosen automatically. Flags are bundled SVGs (flag-icons), so they work offline on Windows.

| Tab | What it shows |
|---|---|
| Profile | Electricity access (total, urban, rural), clean share, best solar (NASA POWER `ALLSKY_SFC_SW_DWN`) and best 50 m wind (`WS50M`) with site names, "High solar potential" / "Promising wind" badges, and the yearly budget (1% of GDP + 10% of resource income, both editable) |
| Peers | Countries that started within ±15 points of this country's access (below 95%) and then gained ≥10 points or reached 95% in 10 years, matched by DTW on electricity features. Each in 3 lines; "Use [Peer]'s playbook →" sets the mix |
| Plan | Recommendation banner, solar / wind / grid & storage split, four result cards (solar MW, wind MW and turbines, km of lines and MWh of storage, access and clean share in 10 years) |
| Stress | 500 budget futures from the country's own GDP and resource-income history, plus "Budget cut 30%", "Costs run over budget +25%", "Construction delay 2 years" |
| Model | The supervised impact model (LightGBM + SHAP) for "if nothing changes", with honest out-of-sample accuracy |

**Ask Nahda** (bottom right) answers through the backend (`POST /api/advisor`) with Gemini and Google Search grounding, falling back to Gemini without search, then Claude if `ANTHROPIC_API_KEY` is set, then an instant offline answer from app data. Keys stay in `backend/.env`; set `GEMINI_MODEL` there to change the model.

## How the plan works (all editable estimates)

- Solar MWh = MW × best-site sunlight × 365 × performance ratio. Wind capacity factor ≈ 0.087 × wind speed − 0.278 (capped 0–50%).
- New people get power only where a new line reaches them (km × homes per km × household size) and new generation can supply them (MWh ÷ use per person).
- Solar and wind are variable, never baseload: at most 60% of demand counts as clean without seasonal storage; storage covers gaps.
- Recommendation: solar and wind share generation in proportion to each resource vs its threshold (no wind below 5 m/s); grid & storage gets the share that balances lines against generation, at least 20%. A peer whose rural access rose fastest adds 10 points to grid & storage; a peer whose clean share rose adds 5 to generation.

## Run it (two terminals)

```
cd backend
python -m uvicorn main:app --port 8000
```

```
cd frontend
npm.cmd run dev
```

Setup on a new machine: `pip install -r backend/requirements.txt`, then `npm install` in `frontend/`. Refresh electricity data with `python fetch_data.py --electricity-only` (urban/rural access and NASA sun/wind at several points per country, concurrent with strict timeouts).

## Tests

- Backend: `cd backend && python -m pytest` (21 tests, including grid ≥ 20%, no wind below 5 m/s, access needs both lines and generation, shocks never help, budget parts add up, peers meet the rule)
- Frontend: `cd frontend && npm test` (number formatting)

## Data

World Bank (access total/urban/rural, clean share, GDP, population, electricity use, resource rents), NASA POWER (sunlight and 50 m wind), Natural Earth outlines. Wind values are point averages at 50 m; turbine sites need detailed local studies.

## Archive

The earlier four-sector plan (power, transportation, tourism, savings, fuel price reform) is in `archive/four-sector/`, not used by the app.

Illustrative planning model built on public data. Not investment advice.
