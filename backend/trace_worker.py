"""Subprocess worker: executes the user's solution under sys.settrace.

Run as:  python -m backend.trace_worker <request.json> <response.json>

This is the ground-truth engine of the whole app. Nothing here guesses what the
code does - it records what the interpreter actually did, line by line.
"""
from __future__ import annotations

import io
import json
import sys
import types
from contextlib import redirect_stdout, redirect_stderr

from backend.snapshot import snap

SOLUTION_FILE = "<solution>"
DRIVER_FILE = "<driver>"

SKIP_TYPES = (
    types.ModuleType,
    types.FunctionType,
    types.BuiltinFunctionType,
    types.MethodType,
    type,
)
SKIP_NAMES = {"self", "cls"}


class StepLimit(Exception):
    """Raised from inside the trace function to abort a runaway program."""


class Tracer:
    def __init__(self, max_steps: int, stdout_buf: io.StringIO):
        self.frames: list[dict] = []
        self.max_steps = max_steps
        self.stdout_buf = stdout_buf
        self.stdout_len = 0
        self.depth = 0
        self.prev_locals: dict[int, dict] = {}
        self.hit_limit = False

    # -- helpers ----------------------------------------------------------- #
    def _snap_locals(self, frame) -> dict:
        out = {}
        for name, value in list(frame.f_locals.items()):
            # `.0` and friends are the implicit iterators CPython creates for
            # comprehensions - real, but noise to a learner.
            if name in SKIP_NAMES or name.startswith("__") or name.startswith("."):
                continue
            if isinstance(value, SKIP_TYPES):
                continue
            try:
                out[name] = snap(value, name=name)
            except Exception as exc:  # never let snapshotting kill the run
                out[name] = {"kind": "object", "cls": "?", "repr": f"<snapshot error: {exc}>"}
        return out

    def _stdout_delta(self) -> str:
        text = self.stdout_buf.getvalue()
        delta = text[self.stdout_len:]
        self.stdout_len = len(text)
        return delta

    def _record(self, frame, event: str, locals_snap: dict, ret=None) -> None:
        fid = id(frame)
        prev = self.prev_locals.get(fid, {})
        changed = [k for k, v in locals_snap.items() if prev.get(k) != v]
        self.prev_locals[fid] = locals_snap

        rec = {
            "i": len(self.frames),
            "event": event,
            "line": frame.f_lineno,
            "func": frame.f_code.co_name,
            "depth": self.depth,
            "frame": fid,
            "locals": locals_snap,
            "changed": changed,
        }
        out = self._stdout_delta()
        if out:
            rec["stdout"] = out
        if event == "return":
            rec["ret"] = ret
        self.frames.append(rec)

        if len(self.frames) >= self.max_steps:
            self.hit_limit = True
            raise StepLimit()

    # -- the trace function ------------------------------------------------ #
    def __call__(self, frame, event, arg):
        if frame.f_code.co_filename != SOLUTION_FILE:
            return None

        if event == "call":
            self.depth += 1
            self._record(frame, "call", self._snap_locals(frame))
            return self

        if event == "line":
            self._record(frame, "line", self._snap_locals(frame))
            return self

        if event == "return":
            try:
                ret_snap = snap(arg)
            except Exception:
                ret_snap = {"kind": "object", "cls": "?", "repr": "<unsnapshotable>"}
            self._record(frame, "return", self._snap_locals(frame), ret=ret_snap)
            self.depth = max(0, self.depth - 1)
            return self

        if event == "exception":
            return self

        return self


def _coerce_args(namespace: dict, args: dict, coercions: dict) -> dict:
    """Turn LeetCode-style plain lists into the node objects the solution expects."""
    from backend.adapters import build_linked_list, build_binary_tree

    out = {}
    for key, value in args.items():
        kind = coercions.get(key)
        if kind == "listnode" and isinstance(value, list):
            out[key] = build_linked_list(value, namespace)
        elif kind == "treenode" and isinstance(value, list):
            out[key] = build_binary_tree(value, namespace)
        elif kind == "list_of_listnodes" and isinstance(value, list):
            out[key] = [build_linked_list(v, namespace) if isinstance(v, list) else v
                        for v in value]
        else:
            out[key] = value
    return out


def main() -> int:
    req = json.loads(open(sys.argv[1], encoding="utf-8").read())
    code: str = req["code"]
    args: dict = req.get("args", {})
    coercions: dict = req.get("coercions", {})
    entry: dict = req.get("entry", {})
    max_steps: int = int(req.get("max_steps", 4000))

    result = {"frames": [], "ok": False, "error": None, "stdout": "", "hit_limit": False}
    stdout_buf, stderr_buf = io.StringIO(), io.StringIO()
    namespace: dict = {"__name__": "__solution__"}

    try:
        compiled = compile(code, SOLUTION_FILE, "exec")
    except SyntaxError as exc:
        result["error"] = {"type": "SyntaxError", "message": str(exc), "line": exc.lineno}
        _write(result)
        return 0

    try:
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            exec(compiled, namespace)

            # Give the solution the node classes it expects, if it did not define them.
            from backend.adapters import ensure_node_classes
            ensure_node_classes(namespace)

            call_args = _coerce_args(namespace, args, coercions)

            if entry.get("cls"):
                instance = namespace[entry["cls"]]()
                target = getattr(instance, entry["func"])
            else:
                target = namespace[entry["func"]]

            tracer = Tracer(max_steps, stdout_buf)
            sys.settrace(tracer)
            try:
                ret = target(**call_args)
            finally:
                sys.settrace(None)

        result["frames"] = tracer.frames
        result["hit_limit"] = tracer.hit_limit
        result["returned"] = snap(ret)
        result["ok"] = True

    except StepLimit:
        sys.settrace(None)
        result["frames"] = tracer.frames
        result["hit_limit"] = True
        result["ok"] = True
        result["returned"] = None

    except Exception as exc:  # noqa: BLE001 - surface any user error verbatim
        sys.settrace(None)
        import traceback

        tb = traceback.extract_tb(sys.exc_info()[2])
        user_lines = [f.lineno for f in tb if f.filename == SOLUTION_FILE]
        result["error"] = {
            "type": type(exc).__name__,
            "message": str(exc),
            "line": user_lines[-1] if user_lines else None,
        }
        frames = getattr(locals().get("tracer", None), "frames", [])
        result["frames"] = frames
        result["ok"] = bool(frames)

    result["stdout"] = stdout_buf.getvalue()[-8000:]
    result["stderr"] = stderr_buf.getvalue()[-2000:]
    _write(result)
    return 0


def _write(result: dict) -> None:
    with open(sys.argv[2], "w", encoding="utf-8") as fh:
        json.dump(result, fh)


if __name__ == "__main__":
    raise SystemExit(main())
