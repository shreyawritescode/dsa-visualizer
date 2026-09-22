"""Bridge between what you paste from NeetCode and what the tracer needs to call.

Three jobs:
  1. Parse a test input block ("nums = [2,7,11,15]") into real Python kwargs.
  2. Find the entry point in the pasted solution (Solution().twoSum, or a bare def).
  3. Rebuild LeetCode's flat list encodings into real ListNode / TreeNode objects.
"""
from __future__ import annotations

import ast
import json
import re

# Names that mean "linked list" on their own, with no other evidence needed.
LISTNODE_PARAMS_STRONG = {
    "head", "head1", "head2", "heada", "headb", "l1", "l2", "list1", "list2",
}
# Names that only mean "linked list" when the code actually walks .next.
LISTNODE_PARAMS_WEAK = {"node", "first", "second", "a", "b"}

TREENODE_PARAMS_STRONG = {"root", "root1", "root2", "subroot", "original", "cloned"}
TREENODE_PARAMS_WEAK = {"p", "q", "tree", "node"}

_LISTNODE_SRC = """
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    def __repr__(self):
        return f"ListNode({self.val})"
"""

_TREENODE_SRC = """
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

    def __repr__(self):
        return f"TreeNode({self.val})"
"""


# --------------------------------------------------------------------------- #
# 1. input parsing
# --------------------------------------------------------------------------- #
def parse_inputs(text: str) -> tuple[dict, list]:
    """Return (kwargs, positional). Accepts JSON, `name = literal` lines, or a bare literal."""
    text = (text or "").strip()
    if not text:
        return {}, []

    # A JSON object maps straight onto kwargs.
    if text.startswith("{"):
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return data, []
        except json.JSONDecodeError:
            pass

    # LeetCode's own "nums = [1,2], target = 3" one-liner.
    normalised = _split_inline_assignments(text)

    try:
        tree = ast.parse(normalised)
    except SyntaxError:
        tree = None

    if tree is not None:
        kwargs = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(
                node.targets[0], ast.Name
            ):
                try:
                    kwargs[node.targets[0].id] = ast.literal_eval(node.value)
                except (ValueError, SyntaxError):
                    continue
        if kwargs:
            return kwargs, []

    # Bare literal(s): treat as positional arguments.
    try:
        value = ast.literal_eval(text)
        return {}, [value]
    except (ValueError, SyntaxError):
        pass

    try:
        return {}, [json.loads(text)]
    except json.JSONDecodeError:
        return {}, []


def _split_inline_assignments(text: str) -> str:
    """`nums = [1,2], target = 3` -> two lines, without splitting inside brackets."""
    if "\n" in text:
        return text
    if len(re.findall(r"\b\w+\s*=", text)) <= 1:
        return text

    out, depth, buf = [], 0, ""
    for ch in text:
        if ch in "[({":
            depth += 1
        elif ch in "])}":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(buf)
            buf = ""
            continue
        buf += ch
    out.append(buf)
    return "\n".join(part.strip() for part in out if part.strip())


# --------------------------------------------------------------------------- #
# 2. entry point discovery
# --------------------------------------------------------------------------- #
def find_entry(code: str, input_names: list[str] | None = None) -> dict:
    """Locate the function to call. Raises ValueError if there is nothing callable."""
    input_names = set(input_names or [])
    tree = ast.parse(code)

    candidates: list[dict] = []

    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if item.name.startswith("_"):
                        continue
                    params = [a.arg for a in item.args.args if a.arg != "self"]
                    candidates.append(
                        {
                            "cls": node.name,
                            "func": item.name,
                            "params": params,
                            "lineno": item.lineno,
                            "score": 2 if node.name == "Solution" else 1,
                        }
                    )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith("_"):
                continue
            params = [a.arg for a in node.args.args]
            candidates.append(
                {
                    "cls": None,
                    "func": node.name,
                    "params": params,
                    "lineno": node.lineno,
                    "score": 1,
                }
            )

    if not candidates:
        raise ValueError(
            "No function found. Paste a `class Solution:` with a method, or a plain `def`."
        )

    for cand in candidates:
        if input_names and set(cand["params"]) == input_names:
            cand["score"] += 10
        elif input_names and input_names.issubset(set(cand["params"])):
            cand["score"] += 5

    candidates.sort(key=lambda c: (-c["score"], c["lineno"]))
    best = candidates[0]
    return {"cls": best["cls"], "func": best["func"], "params": best["params"]}


def coercion_hints(code: str, params: list[str]) -> dict:
    """Decide which params need a flat list rebuilt into linked-list / tree nodes.

    Solutions often never name ListNode/TreeNode - they just walk `.next` or
    `.left`. Attribute usage is the stronger signal, so we look for both.
    """
    walks_next = "ListNode" in code or ".next" in code
    walks_child = "TreeNode" in code or ".left" in code or ".right" in code

    hints: dict[str, str] = {}
    for param in params:
        low = param.lower()
        if low in {"lists", "linkedlists"} and walks_next:
            hints[param] = "list_of_listnodes"
        elif low in LISTNODE_PARAMS_STRONG:
            hints[param] = "listnode"
        elif low in TREENODE_PARAMS_STRONG:
            hints[param] = "treenode"
        elif low in LISTNODE_PARAMS_WEAK and walks_next and not walks_child:
            hints[param] = "listnode"
        elif low in TREENODE_PARAMS_WEAK and walks_child:
            hints[param] = "treenode"
    return hints


# --------------------------------------------------------------------------- #
# 3. node construction
# --------------------------------------------------------------------------- #
def ensure_node_classes(namespace: dict) -> None:
    if "ListNode" not in namespace:
        exec(_LISTNODE_SRC, namespace)
    if "TreeNode" not in namespace:
        exec(_TREENODE_SRC, namespace)


def _make(cls, value):
    try:
        return cls(value)
    except TypeError:
        node = cls()
        for attr in ("val", "value", "data"):
            if hasattr(node, attr):
                setattr(node, attr, value)
                break
        return node


def build_linked_list(values: list, namespace: dict):
    cls = namespace.get("ListNode")
    if cls is None:
        ensure_node_classes(namespace)
        cls = namespace["ListNode"]
    head = prev = None
    for value in values:
        node = _make(cls, value)
        node.next = None
        if head is None:
            head = node
        else:
            prev.next = node
        prev = node
    return head


def build_binary_tree(values: list, namespace: dict):
    """LeetCode level-order encoding, where None means 'no child here'."""
    cls = namespace.get("TreeNode")
    if cls is None:
        ensure_node_classes(namespace)
        cls = namespace["TreeNode"]
    if not values or values[0] is None:
        return None

    root = _make(cls, values[0])
    root.left = root.right = None
    queue = [root]
    index, cursor = 1, 0

    while cursor < len(queue) and index < len(values):
        node = queue[cursor]
        cursor += 1

        if index < len(values):
            value = values[index]
            index += 1
            if value is not None:
                child = _make(cls, value)
                child.left = child.right = None
                node.left = child
                queue.append(child)

        if index < len(values):
            value = values[index]
            index += 1
            if value is not None:
                child = _make(cls, value)
                child.left = child.right = None
                node.right = child
                queue.append(child)

    return root
