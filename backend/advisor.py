"""Ask Nahda and the AI recommendation: short, sourced answers for the selected country.

Source priority: (1) app data (World Bank, NASA) for every number, (2) analysis combining that data with reasoning,
(3) general AI knowledge and web search for context, always with source links when they come from the web.
Order of attempts: Gemini with Google Search grounding -> Gemini without search -> Claude with web search (if
ANTHROPIC_API_KEY is set) -> an offline answer built from app data, so the demo never breaks.
Keys live in backend/.env and never reach the browser. Google's exact errors are printed in the backend terminal."""

import os
import time

import requests
from dotenv import load_dotenv

load_dotenv()

# Checked against the live models list: the newest Flash (gemini-flash-latest) times out on this key and
# gemini-2.5-flash is retired for new users; Flash-Lite answers in about 1 s. Override with GEMINI_MODEL in .env.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-lite-latest")
CLAUDE_MODEL = "claude-sonnet-5-5"
TIMEOUT_S = 15  # per attempt; search gets 10s so the whole answer stays well under the page timeout
FOOTER_WEB = "Based on Nahda data + web search"
FOOTER_MODEL = "Based on Nahda data + AI analysis (web search unavailable, so no web sources)"
OFFLINE = "Offline answer from Nahda data"

RULES = """You are Nahda's electrification advisor, helping countries below 90% electricity access close the gap.
Your readers are regular people: plain words, no jargon.
Sources, in this order of priority:
1. NAHDA DATA (World Bank and NASA) for every number. Never change, round differently, or invent numbers.
2. Analysis that combines that data with reasoning.
3. General knowledge and web search for real-world context only; the app shows web source links.
How to answer:
- Greetings or small talk: 1-2 friendly sentences saying how you can help with the selected country.
  Do not greet or say hello when the user asks a question.
- Questions: answer directly first (1 sentence), then explain why (1-2 sentences), then recommend (1 sentence).
  Under 150 words. No fact dumps: use only the 2-3 numbers that matter.
Rules:
- Solar and wind are variable sources; never call them baseload. Storage and the grid cover gaps.
- Describe each peer's change exactly as written in NAHDA DATA; do not claim causes the data does not state.
- Do not add a sources list yourself; the app adds it."""

STATE = {"last_mode": None, "last_error": None, "search_blocked_until": 0.0}  # status dot, error line, 429 back-off
SEARCH_BACKOFF_S = 600  # after a search quota error, skip web search for 10 minutes instead of failing on every message


def status() -> dict:
    return {"key": bool(os.getenv("GEMINI_API_KEY") or os.getenv("ANTHROPIC_API_KEY")), "last_mode": STATE["last_mode"],
            "last_error": STATE["last_error"]}


def log_error(where: str, e: Exception) -> str:
    msg = str(e).replace("\n", " ")
    print(f"[advisor] {where} failed: {msg[:600]}", flush=True)
    if "search" in where and "429" in msg:
        STATE["search_blocked_until"] = time.time() + SEARCH_BACKOFF_S
    short = ("Google Search quota exceeded for this API key (429)" if "429" in msg and "search" in where
             else "rate limit reached (429)" if "429" in msg else "model not available (404)" if "404" in msg
             else "timed out" if "DEADLINE" in msg or "timed out" in msg.lower() else msg[:120])
    STATE["last_error"] = f"{where}: {short}"
    return short


def ask(question: str, data: str) -> dict:
    out = _ask(question, data)
    STATE["last_mode"] = out["mode"]
    return out


def _ask(question: str, data: str) -> dict:
    start = time.time()
    prompt = f"NAHDA DATA (the only source for statistics):\n{data}\n\nQUESTION: {question}"
    errors = []
    if os.getenv("GEMINI_API_KEY"):
        for grounded in (True, False):
            if grounded and time.time() < STATE["search_blocked_until"]:
                errors.append("Gemini with search: Google Search quota exceeded for this API key (429), retrying later")
                continue
            try:
                text, sources = gemini(prompt, grounded)
                return done(text, sources, "web" if grounded else "model", FOOTER_WEB if grounded else FOOTER_MODEL, start, errors)
            except Exception as e:  # quota, network or model errors: fall through to the next option
                errors.append(f"Gemini{' with search' if grounded else ''}: {log_error('Gemini' + (' + search' if grounded else ''), e)}")
    if os.getenv("ANTHROPIC_API_KEY"):
        try:
            text, sources = claude(prompt)
            return done(text, sources, "web", FOOTER_WEB, start, errors)
        except Exception as e:
            errors.append(f"Claude: {log_error('Claude', e)}")
    if not os.getenv("GEMINI_API_KEY") and not os.getenv("ANTHROPIC_API_KEY"):
        errors.append("no AI key in backend/.env")
    return {"answer": None, "sources": [], "mode": "offline", "label": OFFLINE, "errors": errors,
            "ms": (time.time() - start) * 1000}


def done(text: str, sources: list[dict], mode: str, label: str, start: float, errors: list[str] | None = None) -> dict:
    words = text.split()
    if len(words) > 170:  # hard cap in case the model runs long
        text = " ".join(words[:150]) + "…"
    return {"answer": text.strip(), "sources": sources[:5], "mode": mode, "label": label, "errors": errors or [],
            "ms": (time.time() - start) * 1000}


def gemini(prompt: str, grounded: bool, system: str = RULES) -> tuple[str, list[dict]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                          http_options=types.HttpOptions(timeout=(10 if grounded else TIMEOUT_S) * 1000))
    config = types.GenerateContentConfig(
        system_instruction=system,
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


# ---------- Cached helpers for the Plan recommendation and the Peers examples ----------

_cache: dict = {}
FAILURE_TTL_S = 600  # after a failed call, wait 10 minutes before trying the same thing again (avoids 429 storms)


def cached(key: str, make):
    hit = _cache.get(key)
    if hit and (hit["ok"] or time.time() - hit["at"] < FAILURE_TTL_S):
        return hit["value"]
    value = make()
    _cache[key] = {"value": value, "ok": "unavailable" not in value, "at": time.time()}
    return value


WEB_RULES = """You give short real-world context from web sources. Two or three plain sentences.
Only state what your sources say; if you cannot find a reliable source, reply exactly: NO RELIABLE SOURCE."""


def web(key: str, question: str) -> dict:
    """Context from Google Search grounding, cached per key: {"text", "sources"} or {"unavailable": reason}."""
    def make():
        if not os.getenv("GEMINI_API_KEY"):
            return {"unavailable": "no AI key in backend/.env"}
        if time.time() < STATE["search_blocked_until"]:
            return {"unavailable": "Google Search quota exceeded for this API key (429)"}
        try:
            text, sources = gemini(question, True, WEB_RULES)
        except Exception as e:
            return {"unavailable": log_error("Gemini + search", e)}
        if "NO RELIABLE SOURCE" in text.upper() or not sources:
            return {"unavailable": "no reliable source found"}
        return {"text": text.strip(), "sources": sources[:4]}
    return cached("web:" + key, make)


ANALYSIS_RULES = """You write a tailored electrification recommendation for regular people.
Use ONLY the numbers in NAHDA DATA; never invent numbers. Under 120 words, plain sentences, no headings, no bullet points.
Say what to build first, where (use the site names given), and why; end with one sentence that starts "Risk:".
Solar and wind are variable, never baseload."""


def analysis(key: str, data: str) -> dict:
    """AI analysis of the plan, cached per key: {"text"} or {"unavailable": reason}."""
    def make():
        if not os.getenv("GEMINI_API_KEY"):
            return {"unavailable": "no AI key in backend/.env"}
        try:
            text, _ = gemini(f"NAHDA DATA:\n{data}\n\nWrite the recommendation.", False, ANALYSIS_RULES)
        except Exception as e:
            return {"unavailable": log_error("Gemini", e)}
        return {"text": text.strip()}
    return cached("analysis:" + key, make)


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
