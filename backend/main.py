"""MRUHacks 2026 backend. Run with: uvicorn main:app --reload --port 8000"""

from datetime import datetime

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()  # API keys from backend/.env

app = FastAPI(title="MRUHacks 2026 API")

# Allow the Vite dev server to call the API directly too
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


class PredictRequest(BaseModel):
    values: list[float]


@app.post("/api/predict")
def predict(req: PredictRequest):
    # Placeholder "model": swap in a trained scikit-learn model, e.g. joblib.load("model.joblib")
    prediction = float(np.mean(req.values)) if req.values else 0.0
    return {"input": req.values, "prediction": prediction}
