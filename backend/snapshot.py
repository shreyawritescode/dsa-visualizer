"""Turn a live Python value into a JSON-safe snapshot with structure detection.

Every snapshot is a dict with a "kind" discriminator that the frontend renderers
switch on. Detection is deliberately conservative: shapes that are genuinely
ambiguous (a dict of lists could be a graph, a list of ints could be a heap) are
tagged with an `alt` list so the UI can *offer* the alternate view rather than
guessing wrong and confusing the learner.
"""
from __future__ import annotations

import math
from collections import deque

MAX_ITEMS = 256
MAX_DEPTH = 5
MAX_STR = 400
MAX_NODES = 400

_NUMERIC = (int, float)
_SCALAR = (bool, int, float, str, type(None))

HEAP_NAMES = {
    "heap", "pq", "minheap", "maxheap", "min_heap", "max_heap",
    "priority_queue", "priorityqueue", "h", "q_heap",
}
POINTER_NAMES = {
    "i", "j", "k", "l", "r", "lo", "hi", "mid", "left", "right", "start", "end",
    "slow", "fast", "p", "q", "head_idx", "pivot", "write", "read", "idx", "index",
}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _has(o, *names) -> bool:
    return any(hasattr(o, n) for n in names)


def _node_val(o):
    for a in ("val", "value", "data"):
        if hasattr(o, a):
            return getattr(o, a)
    return None


def is_list_node(o) -> bool:
    """LeetCode-style singly linked list node."""
    return (
        not isinstance(o, _SCALAR)
        and hasattr(o, "next")
        and _has(o, "val", "value", "data")
        and not _has(o, "left", "right")
    )


def is_tree_node(o) -> bool:
    """LeetCode-style binary tree node."""
    return (
        not isinstance(o, _SCALAR)
        and _has(o, "left", "right")
        and _has(o, "val", "value", "data")
    )


def prim(v):
    """Reduce a value to something JSON can carry, for use as a node label."""
    if v is None or isinstance(v, (bool, int, str)):
        if isinstance(v, str) and len(v) > 40:
            return v[:40] + "..."
        return v
    if isinstance(v, float):
        if math.isnan(v):
            return "nan"
        if math.isinf(v):
            return "inf" if v > 0 else "-inf"
        return round(v, 6)
    if isinstance(v, tuple):
        return "(" + ", ".join(str(prim(x)) for x in v[:4]) + ")"
    try:
        s = repr(v)
    except Exception:
        s = "<unrepresentable>"
    return s[:40]


def _is_scalar_row(row) -> bool:
    return isinstance(row, list) and all(isinstance(x, _SCALAR) for x in row)


def _looks_like_grid(v) -> bool:
    if not isinstance(v, list) or not (1 <= len(v) <= 64):
        return False
    if not all(isinstance(r, list) for r in v):
        return False
    widths = {len(r) for r in v}
    if len(widths) != 1:
        return False
    width = widths.pop()
    if not (1 <= width <= 64):
        return False
    return all(_is_scalar_row(r) for r in v)


def _looks_like_adjacency(v) -> bool:
    """dict[node] -> iterable of neighbours, where neighbours are scalars."""
    if not isinstance(v, dict) or not (1 <= len(v) <= 64):
        return False
    for key, val in v.items():
        if not isinstance(key, _SCALAR):
            return False
        if not isinstance(val, (list, set, tuple, deque)):
            return False
        if any(not isinstance(x, _SCALAR) for x in val):
            return False
    return True


def _looks_like_heap(v) -> bool:
    if not isinstance(v, list) or not (1 <= len(v) <= 128):
        return False
    return all(isinstance(x, (int, float)) or
               (isinstance(x, tuple) and x and isinstance(x[0], (int, float)))
               for x in v)


# --------------------------------------------------------------------------- #
# structure snapshots
# --------------------------------------------------------------------------- #
def _snap_linked(head) -> dict:
    """Walk a linked list, index the nodes, and detect a cycle."""
    nodes, seen, cur, cycle_to = [], {}, head, None
    while cur is not None and len(nodes) < MAX_NODES:
        oid = id(cur)
        if oid in seen:
            cycle_to = seen[oid]
            break
        seen[oid] = len(nodes)
        nodes.append({"id": oid, "val": prim(_node_val(cur))})
        cur = getattr(cur, "next", None)
    for n, node in enumerate(nodes):
        node["next"] = n + 1 if n + 1 < len(nodes) else None
    if nodes and cycle_to is not None:
        nodes[-1]["next"] = cycle_to
    return {
        "kind": "linked_list",
        "nodes": nodes,
        "cycle_to": cycle_to,
        "truncated": len(nodes) >= MAX_NODES,
        "len": len(nodes),
    }


def _snap_tree(root) -> dict:
    """Build a nested tree, keeping explicit nulls so the layout stays honest."""
    budget = [MAX_NODES]
    seen = set()

    def build(n, depth):
        if n is None or budget[0] <= 0 or depth > 14:
            return None
        if id(n) in seen:
            return {"val": "<cycle>", "left": None, "right": None, "id": id(n)}
        seen.add(id(n))
        budget[0] -= 1
        return {
            "id": id(n),
            "val": prim(_node_val(n)),
            "left": build(getattr(n, "left", None), depth + 1),
            "right": build(getattr(n, "right", None), depth + 1),
        }

    return {"kind": "tree", "root": build(root, 0), "truncated": budget[0] <= 0}


def _snap_graph(d: dict) -> dict:
    nodes = [prim(k) for k in d.keys()]
    node_set = set(nodes)
    edges = []
    for k, neighbours in d.items():
        src = prim(k)
        for nb in list(neighbours)[:MAX_ITEMS]:
            dst = prim(nb)
            if dst not in node_set:
                nodes.append(dst)
                node_set.add(dst)
            edges.append([src, dst])
    return {"kind": "graph", "nodes": nodes, "edges": edges}


def _snap_heap(v: list) -> dict:
    return {
        "kind": "heap",
        "items": [prim(x) for x in v[:MAX_ITEMS]],
        "len": len(v),
    }


# --------------------------------------------------------------------------- #
# entry point
# --------------------------------------------------------------------------- #
def snap(v, depth: int = 0, name: str | None = None) -> dict:
    if depth > MAX_DEPTH:
        return {"kind": "elided", "repr": "..."}

    # scalars ---------------------------------------------------------------
    if v is None or isinstance(v, bool):
        return {"kind": "scalar", "value": v, "t": type(v).__name__}
    if isinstance(v, _NUMERIC):
        return {"kind": "scalar", "value": prim(v), "t": type(v).__name__}
    if isinstance(v, str):
        return {
            "kind": "string",
            "chars": list(v[:MAX_ITEMS]),
            "value": v[:MAX_STR],
            "len": len(v),
        }

    # node structures -------------------------------------------------------
    if is_list_node(v):
        return _snap_linked(v)
    if is_tree_node(v):
        return _snap_tree(v)

    # containers ------------------------------------------------------------
    if isinstance(v, dict):
        if _looks_like_adjacency(v):
            out = _snap_graph(v)
            out["alt"] = ["map"]
            out["entries"] = [
                [prim(k), snap(val, depth + 1)] for k, val in list(v.items())[:MAX_ITEMS]
            ]
            return out
        return {
            "kind": "map",
            "entries": [
                [prim(k), snap(val, depth + 1)] for k, val in list(v.items())[:MAX_ITEMS]
            ],
            "len": len(v),
            "cls": type(v).__name__,
            "alt": ["graph"] if isinstance(v, dict) and len(v) <= 64 else [],
        }

    if isinstance(v, deque):
        return {
            "kind": "queue",
            "items": [snap(x, depth + 1) for x in list(v)[:MAX_ITEMS]],
            "len": len(v),
        }

    if isinstance(v, (set, frozenset)):
        return {
            "kind": "set",
            "items": [prim(x) for x in list(v)[:MAX_ITEMS]],
            "len": len(v),
        }

    if isinstance(v, tuple):
        return {
            "kind": "tuple",
            "items": [snap(x, depth + 1) for x in v[:MAX_ITEMS]],
            "len": len(v),
        }

    if isinstance(v, list):
        if _looks_like_grid(v):
            return {
                "kind": "grid",
                "rows": [[prim(x) for x in row] for row in v],
                "h": len(v),
                "w": len(v[0]),
                "alt": ["array"],
            }
        if v and all(is_list_node(x) or x is None for x in v[:8]):
            return {
                "kind": "list_of_lists",
                "items": [snap(x, depth + 1) for x in v[:16]],
                "len": len(v),
            }
        if name and name.lower() in HEAP_NAMES and _looks_like_heap(v):
            out = _snap_heap(v)
            out["alt"] = ["array"]
            return out
        return {
            "kind": "array",
            "items": [snap(x, depth + 1) for x in v[:MAX_ITEMS]],
            "len": len(v),
            "alt": [],
        }

    # anything else ---------------------------------------------------------
    try:
        r = repr(v)
    except Exception:
        r = "<unrepresentable>"
    return {"kind": "object", "cls": type(v).__name__, "repr": r[:MAX_STR]}
