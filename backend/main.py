"""MRUHacks 2026 backend. Run with: uvicorn main:app --reload --port 8000"""

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
gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

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
    contents: list = [message]
    if image is not None:
        data = await image.read()
        contents.insert(0, types.Part.from_bytes(data=data, mime_type=image.content_type or "image/jpeg"))
    try:
        response = gemini.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini error: {e}")
    return {"reply": response.text}
