# Nahda (نهضة)

**MRUHacks 2026 · Theme: Revitalize**

Turns a struggling country's resources into a real investment plan, using live World Bank and NASA data.

- **Plan:** split oil revenue across solar, rail, youth jobs and a savings fund, and watch 10-year projections update live
- **Map:** solar/wind sites scored from NASA satellite data. Click one to build there.
- **Stress test:** 1,000 oil-price futures replayed from real Brent history (1988–2025)
- **Optimizer:** finds the budget split that holds up best in bad oil years
- **Compare:** against Norway, the UAE and Botswana
- **AI advisor:** Gemini writes a phased plan from the numbers

```
backend/    FastAPI API (main.py), simulation (model.py), data download (fetch_data.py), data/ CSVs
frontend/   React + TypeScript + Tailwind + Recharts + Leaflet
```

## Run it (two terminals)

```
cd backend
python -m uvicorn main:app --reload --port 8000
```

```
cd frontend
npm run dev
```

Open http://localhost:5173

## Setup

```
cd backend && pip install -r requirements.txt
cd frontend && npm install
```

Put `GEMINI_API_KEY=...` in `backend/.env` (never committed). Refresh data with `python fetch_data.py`.

Data: World Bank WDI + governance indicators, NASA POWER, FRED (Brent). Projections are estimates; every assumption is in `backend/model.py` and shown in the app.
