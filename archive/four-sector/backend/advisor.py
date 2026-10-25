"""Ask Nahda: a short advisor answer for the selected country.

The app's own numbers are the only source for statistics; web search is used only for real-world context.
Order: Gemini with Google Search grounding -> Gemini without search (if search quota is exhausted) ->
Claude with web search (if ANTHROPIC_API_KEY is set) -> an offline answer built from app data, so the demo never breaks.
Keys live in backend/.env and never reach the browser."""

import os
import time

import requests
from dotenv import load_dotenv

load_dotenv()

GEMINI_MODEL = "gemini-flash-lite-latest"  # answers in ~1s on this account; checked against the models list
CLAUDE_MODEL = "claude-sonnet-5-5"
TIMEOUT_S = 15  # per attempt; search gets 10s so the whole answer stays well under the page timeout
FOOTER_WEB = "Based on Nahda data + web search"
FOOTER_MODEL = "Based on Nahda data + model knowledge (web search unavailable)"
OFFLINE = "Offline answer from Nahda data"

RULES = """You are Nahda's advisor for development finance institutions, NGOs and trade organizations.
Rules:
- For every statistic about the country or the plan, use ONLY the numbers in the NAHDA DATA block. Never change, round differently, or invent numbers.
- Use web search only for real-world context: solar suppliers and supply chains, fuel subsidy reform experiences in other countries, tourism and industry opportunities.
- Describe each peer's change exactly as written in NAHDA DATA; do not generalize patterns across peers or claim causes the data does not state.
- Describe options and evidence; do not tell any government what it must do.
- Answer in under 120 words, plain language, no headings, at most 4 short bullet points.
- Do not add a sources list yourself; the app adds it."""


def ask(question: str, data: str) -> dict:
    start = time.time()
    prompt = f"NAHDA DATA (the only source for statistics):\n{data}\n\nQUESTION: {question}"
    errors = []
    if os.getenv("GEMINI_API_KEY"):
        for grounded in (True, False):
            try:
                text, sources = gemini(prompt, grounded)
                return done(text, sources, "web" if grounded else "model", FOOTER_WEB if grounded else FOOTER_MODEL, start)
            except Exception as e:  # quota, network or model errors: fall through to the next option
                errors.append(f"gemini{' + search' if grounded else ''}: {str(e)[:120]}")
    if os.getenv("ANTHROPIC_API_KEY"):
        try:
            text, sources = claude(prompt)
            return done(text, sources, "web", FOOTER_WEB, start)
        except Exception as e:
            errors.append(f"claude: {str(e)[:120]}")
    return {"answer": None, "sources": [], "mode": "offline", "label": OFFLINE, "errors": errors,
            "ms": (time.time() - start) * 1000}


def done(text: str, sources: list[dict], mode: str, label: str, start: float) -> dict:
    words = text.split()
    if len(words) > 140:  # hard cap in case the model runs long
        text = " ".join(words[:120]) + "…"
    return {"answer": text.strip(), "sources": sources[:5], "mode": mode, "label": label, "errors": [],
            "ms": (time.time() - start) * 1000}


def gemini(prompt: str, grounded: bool) -> tuple[str, list[dict]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                          http_options=types.HttpOptions(timeout=(10 if grounded else TIMEOUT_S) * 1000))
    config = types.GenerateContentConfig(
        system_instruction=RULES,
        tools=[types.Tool(google_search=types.GoogleSearch())] if grounded else None,
    )
    r = client.models.generate_content(model=GEMINI_MODEL, contents=prompt, config=config)
    if not r.text:
        raise RuntimeError("empty answer")
    sources = []
    gm = r.candidates[0].grounding_metadata if r.candidates else None
    for ch in (gm.grounding_chunks or []) if gm else []:
        if ch.web and ch.web.uri:
            sources.append({"title": ch.web.title or ch.web.uri, "url": ch.web.uri})
    if grounded and not sources:
        raise RuntimeError("no web sources returned")
    return r.text, sources


def claude(prompt: str) -> tuple[str, list[dict]]:
    res = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json={"model": CLAUDE_MODEL, "max_tokens": 600, "system": RULES,
              "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
              "messages": [{"role": "user", "content": prompt}]},
        timeout=TIMEOUT_S,
    )
    res.raise_for_status()
    blocks = res.json()["content"]
    text = "".join(b.get("text", "") for b in blocks if b["type"] == "text")
    sources = []
    for b in blocks:
        for c in b.get("citations") or []:
            if c.get("url") and all(s["url"] != c["url"] for s in sources):
                sources.append({"title": c.get("title") or c["url"], "url": c["url"]})
    if not text:
        raise RuntimeError("empty answer")
    return text, sources
