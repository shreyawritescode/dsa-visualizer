import { el, isStructural } from '../util.js';
import { renderArray, renderStack, renderQueue } from './array.js';
import { renderMap, renderSet } from './map.js';
import { renderLinkedList } from './linkedlist.js';
import { renderTree } from './tree.js';
import { renderHeap } from './heap.js';
import { renderGraph } from './graph.js';
import { renderGrid } from './grid.js';

/** Views a given snapshot kind can legitimately be drawn as. */
const COMPATIBLE = {
  array: ['array', 'stack', 'queue', 'heap'],
  string: ['array'],
  map: ['map', 'graph'],
  set: ['set'],
  queue: ['queue', 'array', 'stack'],
  heap: ['heap', 'array'],
  grid: ['grid'],
  linked_list: ['linked_list'],
  tree: ['tree'],
  graph: ['graph', 'map'],
  list_of_lists: ['list_of_lists'],
};

const RENDERERS = {
  array: renderArray,
  stack: renderStack,
  queue: renderQueue,
  map: renderMap,
  set: renderSet,
  linked_list: renderLinkedList,
  tree: renderTree,
  heap: renderHeap,
  graph: renderGraph,
  grid: renderGrid,
};

const LABELS = {
  array: 'array', stack: 'stack', queue: 'queue', map: 'hash map', set: 'set',
  linked_list: 'linked list', tree: 'binary tree', heap: 'heap', graph: 'graph',
  grid: 'grid', string: 'string', list_of_lists: 'list of lists',
};

/** Per-variable view override the user picked from the "view as" dropdown. */
const overrides = new Map();

export function setOverride(name, view) { overrides.set(name, view); }
export function clearOverrides() { overrides.clear(); }

export function renderStructure(name, snapshot, ctx, onViewChange) {
  const block = el('div', 'struct');

  const head = el('div', 'struct-head');
  head.appendChild(el('span', 'name', name));

  const chosen = resolveView(name, snapshot);
  head.appendChild(el('span', 'meta', describe(snapshot, chosen)));

  const options = COMPATIBLE[snapshot.kind] || [];
  if (options.length > 1) {
    const select = el('select', 'viewsel');
    for (const option of options) {
      const opt = el('option', null, 'view as ' + LABELS[option]);
      opt.value = option;
      if (option === chosen) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      setOverride(name, select.value);
      onViewChange?.();
    });
    head.appendChild(select);
  }

  block.appendChild(head);

  const render = RENDERERS[chosen];
  try {
    block.appendChild(render ? render(name, adapt(snapshot, chosen), ctx)
                             : el('div', 'cell is-null', String(snapshot.kind)));
  } catch (err) {
    block.appendChild(el('div', 'cell is-null', 'render error: ' + err.message));
  }
  return block;
}

function resolveView(name, snapshot) {
  const wanted = overrides.get(name);
  const options = COMPATIBLE[snapshot.kind] || [snapshot.kind];
  if (wanted && options.includes(wanted)) return wanted;
  if (snapshot.kind === 'string') return 'array';
  if (snapshot.kind === 'list_of_lists') return 'array';
  return snapshot.kind;
}

/** Reshape a snapshot so an alternate renderer can read it. */
function adapt(snapshot, view) {
  if (view === 'heap' && snapshot.kind === 'array') {
    return { kind: 'heap', items: snapshot.items.map(i => i.value ?? i.repr ?? '?'), len: snapshot.len };
  }
  if ((view === 'array' || view === 'stack' || view === 'queue') && snapshot.kind === 'heap') {
    return { kind: 'array', items: snapshot.items.map(v => ({ kind: 'scalar', value: v })), len: snapshot.len };
  }
  if (view === 'graph' && snapshot.kind === 'map') {
    const nodes = snapshot.entries.map(([k]) => String(k));
    const seen = new Set(nodes);
    const edges = [];
    for (const [k, v] of snapshot.entries) {
      for (const item of v.items || []) {
        const dst = String(item.value ?? item);
        if (!seen.has(dst)) { nodes.push(dst); seen.add(dst); }
        edges.push([String(k), dst]);
      }
    }
    return { kind: 'graph', nodes, edges };
  }
  if (view === 'map' && snapshot.kind === 'graph') {
    return { kind: 'map', entries: snapshot.entries || [], len: snapshot.nodes.length };
  }
  return snapshot;
}

function describe(snapshot, view) {
  const base = LABELS[snapshot.kind] || LABELS[view] || snapshot.kind;
  if (snapshot.kind === 'grid') return `${base} · ${snapshot.h}×${snapshot.w}`;
  if (snapshot.len !== undefined) return `${base} · ${snapshot.len} item${snapshot.len === 1 ? '' : 's'}`;
  if (snapshot.kind === 'graph') return `${base} · ${snapshot.nodes.length} nodes`;
  return base;
}

export { isStructural };
