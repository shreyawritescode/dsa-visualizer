import { el, short, isStructural, buildIndexMap, nodeIds } from './util.js';
import { api } from './api.js';
import { initChat } from './chat.js';
import { renderStructure, clearOverrides } from './renderers/index.js';
import { renderCallTree } from './renderers/calltree.js';

const DEFAULT_CODE = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, n in enumerate(nums):
            complement = target - n
            if complement in seen:
                return [seen[complement], i]
            seen[n] = i
        return []
`;

const state = {
  traceId: null,
  frames: [],
  lines: [],
  narration: {},
  step: 0,
  playing: false,
  timer: null,
  maxDepth: 1,
  indexMap: new Map(),
};

const dom = {};
let editor;
let chat;
let lastHighlight = null;

/**
 * Minimal stand-in with the slice of the CodeMirror API this app uses, so the
 * tool still works if the editor script fails to load for any reason.
 */
function plainEditor(host, value) {
  const area = document.createElement('textarea');
  area.className = 'input-box';
  area.style.height = '100%';
  area.value = value;
  host.appendChild(area);
  return {
    getValue: () => area.value,
    setValue: v => { area.value = v; },
    addLineClass() {}, removeLineClass() {},
    getScrollInfo: () => ({ top: 0, clientHeight: area.clientHeight }),
    charCoords: () => ({ top: 0 }),
    scrollTo() {},
  };
}

// ─── boot ──────────────────────────────────────────────────────────────── //
function boot() {
  for (const id of ['title','examples','run','theme','input','canvas','narration','scrub',
                    'counter','speed','vars','status','callpath','first','prev','play','next',
                    'last','play-icon','toast']) {
    dom[id] = document.getElementById(id);
  }

  const savedCode = localStorage.getItem('dsa:code') || DEFAULT_CODE;
  editor = typeof CodeMirror === 'function'
    ? CodeMirror(document.getElementById('editor'), {
        value: savedCode,
        mode: 'python',
        lineNumbers: true,
        indentUnit: 4,
        tabSize: 4,
        lineWrapping: true,
        extraKeys: { 'Cmd-Enter': run, 'Ctrl-Enter': run },
      })
    : plainEditor(document.getElementById('editor'), savedCode);

  dom.input.value = localStorage.getItem('dsa:input') || 'nums = [2,7,11,15]\ntarget = 9';
  dom.title.value = localStorage.getItem('dsa:title') || 'Two Sum';
  document.documentElement.dataset.theme = localStorage.getItem('dsa:theme') || 'dark';

  dom.run.addEventListener('click', run);
  dom.theme.addEventListener('click', toggleTheme);
  dom.first.addEventListener('click', () => goto(0));
  dom.prev.addEventListener('click', () => goto(state.step - 1));
  dom.next.addEventListener('click', () => goto(state.step + 1));
  dom.last.addEventListener('click', () => goto(state.frames.length - 1));
  dom.play.addEventListener('click', togglePlay);
  dom.scrub.addEventListener('input', () => goto(Number(dom.scrub.value)));
  dom.speed.addEventListener('change', () => { if (state.playing) { stop(); togglePlay(); } });
  dom.examples.addEventListener('change', loadExample);

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  }

  document.addEventListener('keydown', onKey);
  chat = initChat(state);

  loadExamples();
  checkStatus();
}

async function checkStatus() {
  try {
    const status = await api.status();
    if (!status.has_key) {
      pill('warn', 'No API key — trace works, explanations are off');
    }
  } catch { /* server not ready yet; the Run button will surface it */ }
}

async function loadExamples() {
  try {
    const examples = await api.examples();
    for (const example of examples) {
      const option = el('option', null, `${example.title}  ·  ${example.pattern}`);
      option.value = JSON.stringify(example);
      dom.examples.appendChild(option);
    }
  } catch { /* examples are optional */ }
}

function loadExample() {
  if (!dom.examples.value) return;
  const example = JSON.parse(dom.examples.value);
  editor.setValue(example.code);
  dom.input.value = example.input;
  dom.title.value = example.title;
  dom.examples.value = '';
  run();
}

// ─── run ───────────────────────────────────────────────────────────────── //
async function run() {
  stop();
  const code = editor.getValue();
  const input = dom.input.value;
  const title = dom.title.value;

  localStorage.setItem('dsa:code', code);
  localStorage.setItem('dsa:input', input);
  localStorage.setItem('dsa:title', title);

  dom.run.classList.add('is-loading');
  dom.status.innerHTML = '';
  clearOverrides();

  try {
    const result = await api.trace(code, input, title);
    state.traceId = result.trace_id;
    state.frames = result.frames || [];
    state.lines = result.lines || [];
    state.narration = {};
    state.indexMap = buildIndexMap(code);
    state.maxDepth = Math.max(
      1,
      ...state.frames.filter(f => !f.func.startsWith('<')).map(f => f.depth)
    );
    chat.reset();

    if (result.error) showError(result.error);
    if (!state.frames.length) {
      dom.scrub.max = 0;
      dom.counter.textContent = '0 / 0';
      if (!result.error) toast('The function ran but no lines were recorded.', true);
      return;
    }

    if (result.entry) {
      const entry = result.entry;
      document.getElementById('entry-chip').textContent =
        `${entry.cls ? entry.cls + '().' : ''}${entry.func}(${entry.params.join(', ')})`;
    }

    dom.scrub.max = state.frames.length - 1;
    buildStatus(result);
    goto(0);
    fetchExplanation(title);
  } catch (err) {
    toast(err.message, true);
  } finally {
    dom.run.classList.remove('is-loading');
  }
}

function buildStatus(result) {
  dom.status.innerHTML = '';
  pill('ok', `${state.frames.length} steps`);
  if (result.returned) pill('', `returns ${short(result.returned)}`);
  if (result.hit_limit) pill('warn', 'step limit hit — trace truncated');
  if (result.error) pill('err', `${result.error.type}`);
  if (result.stdout) pill('', 'printed output below');
}

function pill(kind, text) {
  dom.status.appendChild(el('span', `status-pill ${kind}`, text));
}

function showError(error) {
  const box = el('div', 'error-box');
  box.appendChild(el('h3', null, error.type + (error.line ? ` on line ${error.line}` : '')));
  box.appendChild(el('pre', null, error.message));
  dom.canvas.innerHTML = '';
  dom.canvas.appendChild(box);
  if (error.line) {
    editor.addLineClass(error.line - 1, 'background', 'cm-error-line');
  }
}

async function fetchExplanation(title) {
  const panel = document.getElementById('panel-summary');
  panel.innerHTML = '<div class="side-empty">Reading the trace…</div>';
  try {
    const { summary, narration } = await api.explain(state.traceId, title);
    state.narration = narration || {};
    renderSummary(summary);
    renderFrame();
  } catch (err) {
    panel.innerHTML = '';
    panel.appendChild(el('div', 'side-empty', 'Explanation unavailable: ' + err.message));
  }
}

// ─── summary panel ─────────────────────────────────────────────────────── //
function renderSummary(summary) {
  const panel = document.getElementById('panel-summary');
  panel.innerHTML = '';
  if (!summary) return;

  const approach = el('div', 'sum-block');
  approach.appendChild(el('div', 'sum-label', 'Approach'));
  approach.appendChild(el('div', 'sum-approach', summary.approach || '—'));
  approach.appendChild(el('div', 'sum-body', summary.key_idea || ''));
  panel.appendChild(approach);

  const hasComplexity = [summary.time, summary.space]
    .some(v => v && String(v).trim() && String(v).trim() !== '-');
  if (hasComplexity) {
    const cx = el('div', 'sum-block');
    const row = el('div', 'sum-cx');
    for (const [label, value] of [['Time', summary.time], ['Space', summary.space]]) {
      const box = el('div');
      box.appendChild(el('div', 'cx-k', label));
      const [big, ...rest] = String(value || '—').split(/[—-]|,/);
      box.appendChild(el('div', 'cx-v', big.trim()));
      if (rest.length) box.appendChild(el('div', 'cx-why', rest.join(' ').trim()));
      row.appendChild(box);
    }
    cx.appendChild(row);
    panel.appendChild(cx);
  }

  if (summary.phases?.length) {
    const block = el('div', 'sum-block');
    block.appendChild(el('div', 'sum-label', 'How it unfolds'));
    for (const phase of summary.phases) {
      const row = el('div', 'phase');
      row.appendChild(el('div', 'phase-lines', (phase.lines || []).join('–') || '·'));
      const text = el('div');
      text.appendChild(el('div', 'phase-name', phase.label || ''));
      text.appendChild(el('div', 'phase-what', phase.what || ''));
      row.appendChild(text);
      row.addEventListener('click', () => jumpToLine((phase.lines || [])[0]));
      block.appendChild(row);
    }
    panel.appendChild(block);
  }

  if (summary.watch?.length) {
    const block = el('div', 'sum-block');
    block.appendChild(el('div', 'sum-label', 'Watch these'));
    const tiles = el('div', 'tiles');
    for (const name of summary.watch) tiles.appendChild(el('div', 'tile tile-solo', name));
    block.appendChild(tiles);
    panel.appendChild(block);
  }

  if (summary.gotcha) {
    const box = el('div', 'gotcha');
    box.appendChild(el('b', null, 'Common mistake'));
    box.appendChild(document.createTextNode(summary.gotcha));
    panel.appendChild(box);
  }

  if (summary.error) {
    panel.appendChild(el('div', 'side-empty', summary.error));
  }
}

function jumpToLine(line) {
  if (!line) return;
  const index = state.frames.findIndex((f, i) => i >= 0 && f.line === line);
  if (index >= 0) goto(index);
}

// ─── timeline ──────────────────────────────────────────────────────────── //
function goto(step) {
  if (!state.frames.length) return;
  state.step = Math.max(0, Math.min(step, state.frames.length - 1));
  dom.scrub.value = state.step;
  dom.counter.textContent = `${state.step + 1} / ${state.frames.length}`;
  renderFrame();
  if (state.playing && state.step === state.frames.length - 1) stop();
}

function togglePlay() {
  if (state.playing) return stop();
  if (state.step >= state.frames.length - 1) state.step = -1;
  state.playing = true;
  dom['play-icon'].innerHTML = '<rect x="3.5" y="2.5" width="3.2" height="11" fill="currentColor"/><rect x="9.3" y="2.5" width="3.2" height="11" fill="currentColor"/>';
  state.timer = setInterval(() => goto(state.step + 1), Number(dom.speed.value));
}

function stop() {
  state.playing = false;
  clearInterval(state.timer);
  dom['play-icon'].innerHTML = '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>';
}

function onKey(event) {
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target.closest('.CodeMirror')) {
    if (!(event.key === 'Enter' && (event.metaKey || event.ctrlKey))) return;
  }
  if (event.key === 'ArrowRight') { event.preventDefault(); stop(); goto(state.step + 1); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); stop(); goto(state.step - 1); }
  else if (event.key === ' ') { event.preventDefault(); togglePlay(); }
}

// ─── the frame render ──────────────────────────────────────────────────── //
function renderFrame() {
  const frame = state.frames[state.step];
  if (!frame) return;
  const previous = state.frames[state.step - 1];

  // 1. code highlight
  if (lastHighlight !== null) {
    editor.removeLineClass(lastHighlight, 'background', 'cm-exec-line');
    editor.removeLineClass(lastHighlight, 'gutter', 'cm-exec-gutter');
  }
  const lineIndex = frame.line - 1;
  editor.addLineClass(lineIndex, 'background', 'cm-exec-line');
  editor.addLineClass(lineIndex, 'gutter', 'cm-exec-gutter');
  lastHighlight = lineIndex;
  const scroll = editor.getScrollInfo();
  const coords = editor.charCoords({ line: lineIndex, ch: 0 }, 'local');
  if (coords.top < scroll.top || coords.top > scroll.top + scroll.clientHeight - 40) {
    editor.scrollTo(null, coords.top - scroll.clientHeight / 2);
  }

  // 2. narration
  const template = state.narration[String(frame.line)];
  if (template) {
    dom.narration.hidden = false;
    dom.narration.innerHTML = '';
    dom.narration.appendChild(el('span', 'n-line', `L${frame.line}`));
    const text = el('span', 'n-text');
    fillTemplate(template, frame.locals, text);
    dom.narration.appendChild(text);
  } else {
    dom.narration.hidden = true;
  }

  // 3. call path
  dom.callpath.innerHTML = '';
  if (state.maxDepth > 1) {
    dom.callpath.appendChild(el('span', null, 'depth '));
    const depth = el('b', null, String(frame.depth));
    dom.callpath.appendChild(depth);
    dom.callpath.appendChild(el('span', null, ` · ${frame.func}`));
  } else {
    dom.callpath.textContent = frame.func;
  }

  // 4. structures
  dom.canvas.innerHTML = '';
  const ctx = { locals: frame.locals, frame, step: state.step };
  ctx.indexMap = state.indexMap;
  const entries = Object.entries(frame.locals);
  const structural = dedupeNodeViews(entries.filter(([, snap]) => isStructural(snap)));

  ctx.nodePointers = buildNodePointers(frame);

  for (const [name, snapshot] of structural) {
    ctx.prevSnapshot = previous?.locals?.[name];
    // Inside a recursion, show the whole tree with the current node marked,
    // rather than an orphaned subtree with no context.
    const target = snapshot.kind === 'tree' ? widestTree(name, snapshot, frame) : snapshot;
    dom.canvas.appendChild(renderStructure(name, target, ctx, renderFrame));
  }

  if (state.maxDepth > 1) {
    const block = el('div', 'struct');
    const head = el('div', 'struct-head');
    head.appendChild(el('span', 'name', 'call tree'));
    head.appendChild(el('span', 'meta', `max depth ${state.maxDepth}`));
    block.appendChild(head);
    block.appendChild(renderCallTree(state.frames, state.step));
    dom.canvas.appendChild(block);
  }

  if (!structural.length && state.maxDepth <= 1) {
    dom.canvas.appendChild(el('div', 'side-empty',
      'No data structures in scope at this step — see the variables below.'));
  }

  if (frame.event === 'return') {
    const box = el('div', 'struct');
    box.appendChild(el('div', 'struct-head')).appendChild(el('span', 'name', 'returns'));
    box.appendChild(el('div', 'tiles')).appendChild(el('div', 'tile tile-solo', short(frame.ret)));
    dom.canvas.appendChild(box);
  }

  // 5. variable rail
  dom.vars.innerHTML = '';
  for (const [name, snapshot] of entries) {
    const pill = el('div', 'var-pill');
    pill.appendChild(el('span', 'k', name));
    pill.appendChild(el('span', 'v', short(snapshot)));
    if (frame.changed?.includes(name)) pill.classList.add('is-changed');
    dom.vars.appendChild(pill);
  }
  if (!entries.length) dom.vars.appendChild(el('div', 'side-empty', 'no locals yet'));
}

/** Which node ids the current frame's variables point at, and under what names. */
function buildNodePointers(frame) {
  const pointers = new Map();
  for (const [name, snap] of Object.entries(frame.locals)) {
    let id = null;
    if (snap?.kind === 'tree' && snap.root) id = snap.root.id;
    else if (snap?.kind === 'linked_list' && snap.nodes?.length) id = snap.nodes[0].id;
    if (id === null) continue;
    if (!pointers.has(id)) pointers.set(id, []);
    pointers.get(id).push(name);
  }
  return pointers;
}

/**
 * Walk back through enclosing frames for a bigger version of the same tree, so a
 * recursive call shows the whole tree with the current node marked instead of an
 * orphaned subtree. Only widens when the bigger tree still contains every node of
 * the current one, so a solution that rebuilds the tree keeps its own snapshot.
 */
function widestTree(name, snapshot, frame) {
  if (frame.depth <= 1) return snapshot;
  const currentIds = nodeIds(snapshot);
  let best = snapshot;
  let bestSize = currentIds.size;

  for (let i = state.step; i >= 0; i--) {
    const candidateFrame = state.frames[i];
    if (candidateFrame.depth >= frame.depth) continue;
    const candidate = candidateFrame.locals[name];
    if (candidate?.kind !== 'tree') continue;
    const ids = nodeIds(candidate);
    let contains = true;
    for (const id of currentIds) if (!ids.has(id)) { contains = false; break; }
    if (contains && ids.size > bestSize) { best = candidate; bestSize = ids.size; }
    if (candidateFrame.depth === 1) break;
  }
  return best;
}

/**
 * `prev`, `curr` and `head` often point into one chain. Drawing a panel per
 * variable repeats the same nodes; instead keep only the maximal views and let
 * the renderers label the rest as pointers on those.
 */
function dedupeNodeViews(entries) {
  const nodeEntries = entries.filter(([, s]) => s.kind === 'linked_list' || s.kind === 'tree');
  if (nodeEntries.length < 2) return entries;

  const sets = new Map(nodeEntries.map(([name, snap]) => [name, nodeIds(snap)]));
  const ranked = [...nodeEntries].sort((a, b) => sets.get(b[0]).size - sets.get(a[0]).size);

  const kept = [];
  for (const [name] of ranked) {
    const ids = sets.get(name);
    if (!ids.size) continue;
    const covered = kept.some(other => {
      const target = sets.get(other);
      for (const id of ids) if (!target.has(id)) return false;
      return true;
    });
    if (!covered) kept.push(name);
  }

  const keptSet = new Set(kept);
  return entries.filter(([name, snap]) =>
    (snap.kind !== 'linked_list' && snap.kind !== 'tree') || keptSet.has(name));
}

/** "Complement is {complement}" -> text with the live value bolded. */
function fillTemplate(template, locals, target) {
  const parts = String(template).split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/g);
  for (const part of parts) {
    const match = part.match(/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
    if (match && locals[match[1]]) {
      target.appendChild(el('b', null, short(locals[match[1]])));
    } else if (match) {
      target.appendChild(document.createTextNode(match[1]));
    } else {
      target.appendChild(document.createTextNode(part));
    }
  }
}

// ─── chrome ────────────────────────────────────────────────────────────── //
function switchTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('is-active', tab.dataset.tab === name);
  }
  document.getElementById('panel-summary').classList.toggle('is-active', name === 'summary');
  document.getElementById('panel-tutor').classList.toggle('is-active', name === 'tutor');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('dsa:theme', next);
}

let toastTimer;
function toast(message, isError) {
  dom.toast.textContent = message;
  dom.toast.className = 'toast' + (isError ? ' err' : '');
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 5200);
}

boot();
