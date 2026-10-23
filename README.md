# MRUHacks 2026

```
backend/    FastAPI server (main.py) + notebook for data/ML work (main.ipynb)
frontend/   React + TypeScript + Tailwind (Vite)
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

Open http://localhost:5173. API docs: http://localhost:8000/docs

## Teammate setup

```
cd backend && pip install -r requirements.txt
cd frontend && npm install
```

Put API keys in `backend/.env` (never committed).
