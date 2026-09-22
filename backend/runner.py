"""Runs the tracer in a separate process with a wall clock and resource ceiling.

Executing pasted code is arbitrary code execution. A subprocess with rlimits and
a timeout is the right level of care for a tool you run on your own laptop; it is
NOT a sandbox. See the security note in README.md before exposing this to anyone else.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_MAX_STEPS = int(os.getenv("DSA_MAX_STEPS", "4000"))
DEFAULT_TIMEOUT = int(os.getenv("DSA_TIMEOUT_SECONDS", "10"))

MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024  # 1 GiB


def _limits():  # pragma: no cover - POSIX only, exercised in the child
    try:
        import resource

        cpu = DEFAULT_TIMEOUT + 2
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        try:
            resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
        except (ValueError, OSError):
            pass  # macOS is inconsistent about RLIMIT_AS; the CPU cap still holds.
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except Exception:
        pass


def run_trace(
    code: str,
    input_text: str = "",
    max_steps: int | None = None,
    timeout: int | None = None,
) -> dict:
    from backend.adapters import coercion_hints, find_entry, parse_inputs

    max_steps = max_steps or DEFAULT_MAX_STEPS
    timeout = timeout or DEFAULT_TIMEOUT

    kwargs, positional = parse_inputs(input_text)

    try:
        entry = find_entry(code, list(kwargs.keys()))
    except SyntaxError as exc:
        return _fail("SyntaxError", str(exc), getattr(exc, "lineno", None), code)
    except ValueError as exc:
        return _fail("SetupError", str(exc), None, code)

    params = entry["params"]

    if positional:
        if len(positional) > len(params):
            return _fail(
                "SetupError",
                f"Got {len(positional)} input value(s) but {entry['func']} takes {len(params)}.",
                None,
                code,
            )
        kwargs = dict(zip(params, positional))

    missing = [p for p in params if p not in kwargs]
    if missing:
        return _fail(
            "SetupError",
            f"Missing test input for: {', '.join(missing)}. "
            f"Add a line like `{missing[0]} = ...` in the Test input box.",
            None,
            code,
        )

    kwargs = {k: v for k, v in kwargs.items() if k in params}

    request = {
        "code": code,
        "args": kwargs,
        "coercions": coercion_hints(code, params),
        "entry": entry,
        "max_steps": max_steps,
    }

    with tempfile.TemporaryDirectory() as tmp:
        req_path = Path(tmp) / "request.json"
        res_path = Path(tmp) / "response.json"
        req_path.write_text(json.dumps(request), encoding="utf-8")

        env = dict(os.environ)
        env["PYTHONPATH"] = str(PROJECT_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
        env["PYTHONDONTWRITEBYTECODE"] = "1"

        popen_kwargs = {
            "cwd": str(PROJECT_ROOT),
            "env": env,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
        }
        if os.name == "posix":
            popen_kwargs["preexec_fn"] = _limits

        try:
            proc = subprocess.run(
                [sys.executable, "-m", "backend.trace_worker", str(req_path), str(res_path)],
                timeout=timeout,
                **popen_kwargs,
            )
        except subprocess.TimeoutExpired:
            return _fail(
                "Timeout",
                f"Execution exceeded {timeout}s. Likely an infinite loop, or an input "
                f"too large to visualize - try a smaller one.",
                None,
                code,
            )

        if not res_path.exists():
            stderr = (proc.stderr or b"").decode("utf-8", "replace")[-1500:]
            return _fail("WorkerCrash", stderr or "The tracer process died.", None, code)

        result = json.loads(res_path.read_text(encoding="utf-8"))

    result["entry"] = entry
    result["args"] = _jsonable(kwargs)
    result["source"] = code
    result["lines"] = code.split("\n")
    return result


def _jsonable(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return {k: repr(v) for k, v in value.items()} if isinstance(value, dict) else repr(value)


def _fail(kind: str, message: str, line, code: str) -> dict:
    return {
        "ok": False,
        "frames": [],
        "error": {"type": kind, "message": message, "line": line},
        "source": code,
        "lines": code.split("\n"),
        "stdout": "",
    }
