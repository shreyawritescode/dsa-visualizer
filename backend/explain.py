"""Claude-backed explanation, grounded in the real execution trace.

The important design choice: Claude never invents the steps. It sees the code,
the list of lines that actually executed, and the variables that actually existed,
then writes *narration templates* keyed by line number - one call for the whole
run, rather than one call per step. The frontend fills `{placeholders}` from the
live locals at each frame, so the prose always matches what the interpreter did.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache

_FALLBACK_MODEL = "claude-sonnet-4-5"


# --------------------------------------------------------------------------- #
# client
# --------------------------------------------------------------------------- #
def has_key() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


@lru_cache(maxsize=1)
def get_client():
    import anthropic

    return anthropic.Anthropic()


@lru_cache(maxsize=1)
def resolve_model() -> str:
    """Use ANTHROPIC_MODEL if set, else ask the API for the newest Sonnet."""
    configured = os.getenv("ANTHROPIC_MODEL")
    if configured:
        return configured
    try:
        models = get_client().models.list(limit=50)
        ids = [m.id for m in models.data]
        for wanted in ("sonnet", "opus", "haiku"):
            matches = [i for i in ids if wanted in i.lower()]
            if matches:
                return matches[0]
    except Exception:
        pass
    return _FALLBACK_MODEL


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    return {}


# --------------------------------------------------------------------------- #
# trace digest - what Claude is allowed to see
# --------------------------------------------------------------------------- #
def build_digest(trace: dict, max_lines: int = 60) -> str:
    lines = trace.get("lines", [])
    numbered = "\n".join(f"{i + 1:>3}| {line}" for i, line in enumerate(lines[:200]))

    frames = trace.get("frames", [])
    executed = sorted({f["line"] for f in frames})
    var_kinds: dict[str, str] = {}
    for frame in frames:
        for name, value in frame["locals"].items():
            var_kinds.setdefault(name, value.get("kind", "?"))

    sample = []
    for frame in frames[: min(len(frames), max_lines)]:
        summary = ", ".join(
            f"{k}={_short(v)}" for k, v in list(frame["locals"].items())[:6]
        )
        sample.append(f"  step {frame['i']} [{frame['event']}] line {frame['line']}: {summary}")

    return (
        f"SOURCE:\n{numbered}\n\n"
        f"ENTRY: {trace.get('entry', {}).get('func')}\n"
        f"ARGS: {json.dumps(trace.get('args', {}))[:600]}\n"
        f"TOTAL STEPS: {len(frames)}\n"
        f"LINES THAT EXECUTED: {executed}\n"
        f"VARIABLES AND THEIR SHAPES: {json.dumps(var_kinds)}\n"
        f"RETURNED: {json.dumps(trace.get('returned'))[:300]}\n\n"
        f"FIRST STEPS OF THE REAL TRACE:\n" + "\n".join(sample)
    )


def _short(snapshot: dict) -> str:
    kind = snapshot.get("kind")
    if kind == "scalar":
        return str(snapshot.get("value"))
    if kind == "string":
        return json.dumps(snapshot.get("value", ""))[:40]
    if kind == "array":
        return "[" + ", ".join(str(i.get("value", i.get("kind"))) for i in snapshot.get("items", [])[:8]) + "]"
    if kind == "map":
        return "{" + ", ".join(f"{k}: {_short(v)}" for k, v in snapshot.get("entries", [])[:5]) + "}"
    if kind == "set":
        return "{" + ", ".join(str(x) for x in snapshot.get("items", [])[:6]) + "}"
    if kind == "grid":
        return f"grid {snapshot.get('h')}x{snapshot.get('w')}"
    if kind == "linked_list":
        return " -> ".join(str(n["val"]) for n in snapshot.get("nodes", [])[:8])
    if kind == "tree":
        return "tree"
    if kind == "heap":
        return "heap" + str(snapshot.get("items", [])[:6])
    return str(kind)


# --------------------------------------------------------------------------- #
# 1. summary
# --------------------------------------------------------------------------- #
SUMMARY_PROMPT = """You are a DSA tutor. Below is a Python solution and a factual record of \
what happened when it ran. Explain the approach.

{digest}

Respond with ONLY a JSON object:
{{
  "approach": "the named technique, e.g. 'Hash map one-pass' or 'Two pointers, opposite ends'",
  "key_idea": "2-3 sentences on the insight that makes this work. Plain language, no hedging.",
  "time": "O(...) with a half-sentence reason",
  "space": "O(...) with a half-sentence reason",
  "phases": [
    {{"label": "short phase name", "lines": [3, 4], "what": "one sentence on what this phase accomplishes"}}
  ],
  "watch": ["the 1-3 variables a learner should keep their eye on"],
  "gotcha": "the one thing people most often get wrong here, in one sentence"
}}

Rules: only reference lines that actually executed. Only name variables that actually existed. \
Never describe a branch that did not run on this input - say 'not taken on this input' instead."""


def summarize(trace: dict, title: str = "") -> dict:
    if not has_key():
        return _offline_summary(trace)
    digest = build_digest(trace)
    if title:
        digest = f"PROBLEM TITLE: {title}\n\n{digest}"
    try:
        resp = get_client().messages.create(
            model=resolve_model(),
            max_tokens=1600,
            messages=[
                {"role": "user", "content": SUMMARY_PROMPT.format(digest=digest)},
                {"role": "assistant", "content": "{"},
            ],
        )
        data = _extract_json("{" + resp.content[0].text)
        if data:
            return data
    except Exception as exc:
        return {**_offline_summary(trace), "error": f"{type(exc).__name__}: {exc}"}
    return _offline_summary(trace)


def _offline_summary(trace: dict) -> dict:
    frames = trace.get("frames", [])
    names = sorted({k for f in frames for k in f["locals"]})
    return {
        "approach": "(no API key - trace only)",
        "key_idea": (
            f"The solution ran {len(frames)} steps across "
            f"{len({f['line'] for f in frames})} distinct lines. "
            "Add ANTHROPIC_API_KEY to .env for a written explanation."
        ),
        "time": "-",
        "space": "-",
        "phases": [],
        "watch": names[:3],
        "gotcha": "",
        "offline": True,
    }


# --------------------------------------------------------------------------- #
# 2. per-line narration templates
# --------------------------------------------------------------------------- #
NARRATE_PROMPT = """You are annotating a Python solution for a step-through visualizer.

{digest}

For EACH line number that executed, write one short present-tense sentence describing what \
that line does at that moment. You may embed live values using {{variable}} placeholders - \
the visualizer substitutes the variable's real value at that step.

Respond with ONLY a JSON object mapping line number (as a string) to the sentence:
{{"4": "Looking at index {{i}}, value {{n}}", "5": "The complement we need is {{complement}}"}}

Rules:
- Max 90 characters per sentence.
- Only use {{placeholders}} for variables that are in scope on that line.
- Be concrete about the algorithm, not the syntax. "Shrink the window from the left"
  beats "increment the variable left".
- No line numbers or code in the text itself."""


def narrate(trace: dict) -> dict:
    if not has_key():
        return {}
    try:
        resp = get_client().messages.create(
            model=resolve_model(),
            max_tokens=2000,
            messages=[
                {"role": "user", "content": NARRATE_PROMPT.format(digest=build_digest(trace))},
                {"role": "assistant", "content": "{"},
            ],
        )
        data = _extract_json("{" + resp.content[0].text)
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except Exception:
        return {}


# --------------------------------------------------------------------------- #
# 3. chat
# --------------------------------------------------------------------------- #
CHAT_SYSTEM = """You are a DSA tutor sitting next to a learner who is stepping through a \
Python solution in a visualizer. You can see the code and the real execution trace.

Ground every claim in the trace. If they ask "why did X not change on step 12", read the \
trace and answer from it. If the trace does not contain the answer, say so rather than \
guessing. Keep answers short - a few sentences. Use the learner's variable names. Do not \
dump the whole solution back at them unless they ask for code.

If they are about to go down a wrong path, say so directly."""


def chat_stream(trace: dict, history: list[dict], step: int | None = None):
    """Yields text chunks. Raises RuntimeError when no API key is configured."""
    if not has_key():
        raise RuntimeError("No ANTHROPIC_API_KEY configured - add one to .env to use the tutor.")

    context = build_digest(trace, max_lines=40)
    frames = trace.get("frames", [])
    if step is not None and 0 <= step < len(frames):
        frame = frames[step]
        detail = ", ".join(f"{k}={_short(v)}" for k, v in frame["locals"].items())
        context += (
            f"\n\nTHE LEARNER IS CURRENTLY PAUSED AT step {step}, line {frame['line']} "
            f"in {frame['func']}. Locals right now: {detail}"
        )

    messages = [{"role": "user", "content": f"<context>\n{context}\n</context>"},
                {"role": "assistant", "content": "Got it - I can see the code and the trace."}]
    messages.extend(history[-20:])

    with get_client().messages.stream(
        model=resolve_model(),
        max_tokens=1200,
        system=CHAT_SYSTEM,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            yield text
