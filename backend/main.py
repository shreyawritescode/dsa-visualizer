"""FastAPI app: trace, explain, chat, examples."""
from __future__ import annotations

import json
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

from backend import explain  # noqa: E402  (must load after dotenv)
from backend.runner import run_trace  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
EXAMPLES = ROOT / "examples"

app = FastAPI(title="DSA Visualizer", version="1.0.0")

# Traces live in memory - this is a single-user local tool, not a service.
TRACES: "OrderedDict[str, dict]" = OrderedDict()
MAX_TRACES = 20


class TraceRequest(BaseModel):
    code: str
    input: str = ""
    title: str = ""
    max_steps: Optional[int] = Field(default=None, ge=10, le=50_000)


class ExplainRequest(BaseModel):
    trace_id: str
    title: str = ""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    trace_id: str
    messages: list[ChatMessage]
    step: Optional[int] = None


def _remember(trace: dict) -> str:
    trace_id = uuid.uuid4().hex[:12]
    TRACES[trace_id] = trace
    while len(TRACES) > MAX_TRACES:
        TRACES.popitem(last=False)
    return trace_id


def _get(trace_id: str) -> dict:
    trace = TRACES.get(trace_id)
    if trace is None:
        raise HTTPException(404, "Trace not found - run the code again.")
    return trace


@app.get("/api/status")
def status() -> dict:
    return {
        "has_key": explain.has_key(),
        "model": explain.resolve_model() if explain.has_key() else None,
    }


@app.post("/api/trace")
def trace(req: TraceRequest) -> dict:
    if not req.code.strip():
        raise HTTPException(400, "No code provided.")
    result = run_trace(req.code, req.input, max_steps=req.max_steps)
    trace_id = _remember(result)
    return {
        "trace_id": trace_id,
        "ok": result.get("ok", False),
        "error": result.get("error"),
        "frames": result.get("frames", []),
        "lines": result.get("lines", []),
        "entry": result.get("entry"),
        "args": result.get("args", {}),
        "returned": result.get("returned"),
        "stdout": result.get("stdout", ""),
        "hit_limit": result.get("hit_limit", False),
    }


@app.post("/api/explain")
def explain_trace(req: ExplainRequest) -> dict:
    trace_data = _get(req.trace_id)
    return {
        "summary": explain.summarize(trace_data, req.title),
        "narration": explain.narrate(trace_data),
    }


@app.post("/api/chat")
def chat(req: ChatRequest):
    trace_data = _get(req.trace_id)
    history = [m.model_dump() for m in req.messages]

    def event_stream():
        try:
            for chunk in explain.chat_stream(trace_data, history, req.step):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as exc:  # surface the reason in the chat bubble
            yield f"data: {json.dumps({'error': f'{type(exc).__name__}: {exc}'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/examples")
def examples() -> list[dict]:
    out = []
    for path in sorted(EXAMPLES.glob("*.json")):
        try:
            out.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return out


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
