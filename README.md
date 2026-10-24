# NAHDA TERMINAL (نهضة)

**MRUHacks 2026 · Theme: Revitalize**

An infrastructure and capital planning terminal for resource-rich countries that have fallen behind. Demoed on Libya; works for any country in the dataset. Two voices on every screen: the terminal (exact data) and the analyst (one plain-English note per number).

| Tab | What it does |
|---|---|
| 1 OVERVIEW | Resource revenue, energy gap, untapped solar potential, peer screener |
| 2 ALLOCATE | Divert 0–30% of resource revenue across solar / rail / sovereign wealth fund; editable assumptions; capital vs value created |
| 3 PROJECTS | Pick a solar site on the map → deal card (CAPEX, output, IRR, NPV, payback); rail cost between two cities |
| 4 STRESS | Oil −40%, production shutdown, CAPEX +25%, rates +200 bps; 500-run Monte Carlo; Fiscal Resilience Score |
| 5 MEMO | One-page plan memo (Markdown download) + ask the analyst (Gemini) |

Keys `1`–`5` switch tabs. Every computed number has a `[?] WHY THIS NUMBER` drill-down.

```
backend/   main.py (API), model.py (calculations + assumptions), notes.py (analyst notes),
           fetch_data.py (downloads data), data/ (World Bank, NASA POWER, FRED CSVs)
frontend/  React + TypeScript + Tailwind + Recharts + Leaflet
```

## Run it (two terminals)

```
cd backend
python -m uvicorn main:app --reload --port 8000
```

```
cd frontend
npm.cmd run dev
```

Open http://localhost:5173

## Setup

```
cd backend && pip install -r requirements.txt
cd frontend && npm install
```

`GEMINI_API_KEY=...` in `backend/.env` enables "Ask the Analyst" (never committed). Refresh data with `python fetch_data.py`.

Illustrative planning model built on public World Bank and NASA data and the assumptions shown. Not investment advice.
