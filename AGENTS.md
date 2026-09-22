# AGENTS.md

Context for an agent picking this project up (Antigravity, Claude Code, or a human).
Read this before changing anything; the contracts below are load-bearing.

## The one rule

**The trace is ground truth. The model narrates it; the model never produces it.**

Every visual in this app comes from a real `sys.settrace` recording of the user's code.
If you find yourself adding a code path where an LLM invents steps, variable values, or
execution order, you have broken the premise of the tool. Claude's inputs are always a
digest of the recorded trace (`explain.build_digest`), never the bare source.

## Architecture

```
browser  ──POST /api/trace──▶  runner.run_trace
                                   │  subprocess, rlimits, timeout
                                   ▼
                              trace_worker  ──sys.settrace──▶  user's solution
                                   │
                                   ▼  frames[]
browser  ◀────────────────────  FastAPI  ──▶  explain.py ──▶ Anthropic API
```

The trace is computed once and cached in memory (`main.TRACES`, last 20, keyed by a
random id). `/api/explain` and `/api/chat` take that `trace_id` so the code is never
re-run for an explanation.

## Contracts

### Frame record (`trace_worker.Tracer._record`)

```jsonc
{
  "i": 12,                 // index into frames[]
  "event": "line",         // "call" | "line" | "return"
  "line": 6,               // 1-based line in the user's source
  "func": "twoSum",        // "<listcomp>" for comprehensions - filter these from call trees
  "depth": 1,              // call depth; 1 is the entry function
  "frame": 140234...,      // id() of the Python frame - identifies one invocation
  "locals": { "nums": <snapshot>, ... },
  "changed": ["seen"],     // names whose snapshot differs from this frame's previous record
  "ret": <snapshot>        // on "return" only
}
```

`frame` is what pairs a `return` with its `call` - depth alone is not enough, sibling
calls share it.

### Snapshot (`snapshot.snap`)

Every value becomes `{"kind": ..., ...}`. Kinds: `scalar`, `string`, `array`, `tuple`,
`map`, `set`, `queue`, `heap`, `grid`, `linked_list`, `tree`, `graph`, `list_of_lists`,
`object`, `elided`.

Detection is **conservative by design**. Shapes that are genuinely ambiguous get an
`alt` list so the UI can offer the other reading rather than guessing. Do not "improve"
this by auto-detecting more aggressively - a wrongly-typed structure teaches the learner
something false. Node identity (`id`) is carried on linked-list and tree nodes and is
what lets the frontend label pointers; do not drop it.

Caps live at the top of `snapshot.py` (`MAX_ITEMS`, `MAX_DEPTH`, `MAX_NODES`).

### Renderer (`frontend/js/renderers/*.js`)

```js
export function renderThing(name, snapshot, ctx) → HTMLElement
```

`ctx` carries:

| field | meaning |
|---|---|
| `locals` | every snapshot in the current frame |
| `prevSnapshot` | this variable one step earlier, for change highlighting - may be undefined |
| `indexMap` | `Map<indexVar, Set<container>>` from `buildIndexMap(source)` |
| `nodePointers` | `Map<nodeId, [varNames]>` for linked-list and tree labelling |
| `frame`, `step` | the raw frame record and its index |

To add a renderer: write the module, register it in `renderers/index.js` under
`RENDERERS`, add the kind to `COMPATIBLE` (which views a kind may be switched to) and
`LABELS`, and if the view needs reshaped data, extend `adapt()`.

### Narration templates (`explain.narrate`)

Claude returns `{"<line number>": "sentence with {variable} placeholders"}` - **one API
call for the whole run**, not one per step. `app.js:fillTemplate` substitutes the live
value at each frame. Keep it this way; per-step calls would be slow and expensive for
no gain in accuracy.

## Deliberate decisions, with their trade-offs

- **Cursor binding is source-evidenced.** `util.collectPointers` only draws a variable
  as a cursor on a container the source actually subscripts with it, falling back to a
  short list of classic index names. `start`, `end`, `n`, `a`, `b` are excluded on
  purpose. Widening this list will produce confidently wrong arrows.
- **Node views are deduplicated.** `app.dedupeNodeViews` keeps only maximal node sets,
  so `head` / `prev` / `curr` over one chain render as one or two panels with the others
  as labels, not four near-identical drawings.
- **Trees widen inside recursion.** `app.widestTree` walks out to an enclosing frame for
  a bigger version of the same tree, so a recursive call shows the whole tree with the
  current node marked. It only widens when the bigger tree contains every node of the
  current one. *Known gap:* a solution that mutates or rebuilds the tree will fall back
  to the local snapshot, which is correct but loses context.
- **CodeMirror is vendored** in `frontend/vendor/` so the app works with no network.
  `app.plainEditor` is a textarea fallback if the editor script ever fails to load.
  Google Fonts is the only remaining CDN dependency and degrades to system fonts.
- **Comprehension frames are recorded but filtered.** They are real execution, so the
  tracer keeps them; the call tree and the max-depth calculation skip `func` names
  starting with `<`, and `snapshot` drops the implicit `.0` iterator.

## Not built yet

Roughly in order of value:

1. **Union-Find / disjoint set view.** Blind 75 has several; currently renders as a flat
   array of parents, which is legible but not illuminating.
2. **Trie view.** `word-search-ii` and `implement-trie` render as nested dicts today.
3. **Matrix-as-graph overlay for grid DFS/BFS.** `num-islands` shows the grid correctly
   but not the frontier or the visited set on top of it.
4. **Interval / sweep-line timeline.** A horizontal bar chart for `merge-intervals` and
   `non-overlapping-intervals`.
5. **Diff-only step mode.** Skip frames where nothing in `changed` is interesting, so a
   long loop can be scrubbed by iteration rather than by line.
6. **Bit-manipulation view.** Binary digit strip for `counting-bits`, `reverse-bits`.
7. **Save a run.** Nothing persists; a reload loses the trace. A small SQLite table keyed
   by problem title would let her revisit a solved problem.
8. **Compare two solutions.** Trace both, show step counts side by side. This is the
   feature that would make the brute-force-vs-optimal conversation concrete.
9. **Real sandboxing** if this is ever hosted. See the security section in README.md.

## Testing

There is no test suite yet - that is the biggest gap in the repo. What exists:

```bash
# every example must trace cleanly
python3 - <<'EOF'
import json, pathlib
from backend.runner import run_trace
for p in sorted(pathlib.Path("examples").glob("*.json")):
    ex = json.loads(p.read_text())
    r = run_trace(ex["code"], ex["input"])
    print("OK " if r["ok"] and not r.get("error") else "FAIL", ex["title"], len(r["frames"]))
EOF
```

Worth adding: pytest over `examples/` asserting frame counts and returned values, plus a
Playwright pass that loads each example and asserts the expected renderer appears and the
console is clean.

## Style

Python: standard library plus FastAPI/pydantic/anthropic; type hints on public functions;
no formatter is enforced. JS: ES modules, no build step, no framework, no bundler - keep
it that way, the whole point is that `./run.sh` is the only setup. CSS: custom properties
in `:root` with a `[data-theme="light"]` override; both themes must stay legible.
