"""MRUHacks 2026 backend. Run with: uvicorn main:app --reload --port 8000"""

import asyncio
import os
from datetime import datetime

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel

load_dotenv()  # API keys from backend/.env

GEMINI_MODEL = "gemini-flash-latest"
GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Server still starts without a key; only /api/chat needs it
gemini = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

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


# Change this to give the AI a role for your project
SYSTEM_PROMPT = "You are a helpful assistant. Keep answers short and clear."


@app.post("/api/chat")
async def chat(message: str = Form(...), image: UploadFile | None = File(None)):
    """Send a message to Gemini, optionally with an image (multipart form data)."""
    if gemini is None:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY missing. Add it to backend/.env")
    contents: list = [message]
    if image is not None:
        data = await image.read()
        contents.insert(0, types.Part.from_bytes(data=data, mime_type=image.content_type or "image/jpeg"))
    # Gemini sometimes returns 503 "high demand": retry, then fall back to the lite model
    last_error = None
    for model in [GEMINI_MODEL, GEMINI_MODEL, GEMINI_FALLBACK_MODEL]:
        try:
            response = await gemini.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
            )
            return {"reply": response.text}
        except Exception as e:
            last_error = e
            await asyncio.sleep(1)
    raise HTTPException(status_code=502, detail=f"Gemini is busy, try again. ({last_error})")
