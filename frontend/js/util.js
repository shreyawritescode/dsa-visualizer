// Small DOM + formatting helpers shared by every renderer.

export const PALETTE = ['--p1','--p2','--p3','--p4','--p5','--p6','--p7','--p8'];

// Names that are almost always a cursor rather than a value. Deliberately does
// NOT include `start`, `end`, `n`, `a`, `b` - those are usually bounds or values,
// and a wrong pointer is more confusing than no pointer.
const CLASSIC_INDEX = new Set([
  'i','j','k','l','r','lo','hi','mid','left','right','slow','fast','idx','index','low','high'
]);

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

/** Stable colour per name, so `left` stays the same colour all run. */
export function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `var(${PALETTE[hash % PALETTE.length]})`;
}

/** Render a snapshot down to a single short display string. */
export function short(snapshot) {
  if (!snapshot) return '—';
  switch (snapshot.kind) {
    case 'scalar':  return snapshot.value === null ? 'None'
                         : snapshot.value === true ? 'True'
                         : snapshot.value === false ? 'False'
                         : String(snapshot.value);
    case 'string':  return JSON.stringify(snapshot.value ?? '');
    case 'array':   return '[' + snapshot.items.map(short).join(', ') + ']';
    case 'tuple':   return '(' + snapshot.items.map(short).join(', ') + ')';
    case 'set':     return snapshot.len === 0 ? 'set()' : '{' + snapshot.items.join(', ') + '}';
    case 'map':     return '{' + snapshot.entries.map(([k, v]) => `${fmt(k)}: ${short(v)}`).join(', ') + '}';
    case 'queue':   return 'deque([' + snapshot.items.map(short).join(', ') + '])';
    case 'heap':    return '[' + snapshot.items.map(fmt).join(', ') + ']';
    case 'grid':    return `${snapshot.h}×${snapshot.w} grid`;
    case 'linked_list': {
      const body = snapshot.nodes.map(n => n.val).join(' → ');
      return snapshot.nodes.length ? body : 'None';
    }
    case 'tree':    return snapshot.root ? `tree(${snapshot.root.val})` : 'None';
    case 'graph':   return `graph (${snapshot.nodes.length} nodes)`;
    case 'list_of_lists': return `[${snapshot.len} lists]`;
    case 'object':  return snapshot.repr ?? snapshot.cls;
    case 'elided':  return '…';
    default:        return String(snapshot.kind);
  }
}

export function fmt(value) {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return value;
  return String(value);
}

/** True when this snapshot is worth a dedicated panel rather than a pill. */
export function isStructural(snapshot) {
  return ['array','string','map','set','grid','linked_list','tree','graph','heap','queue','list_of_lists']
    .includes(snapshot?.kind);
}

/**
 * Read the source for subscript expressions - `nums[i]`, `dp[i][j]`, `s[right]` -
 * and record which variables index which containers. This is what stops `start`
 * from being drawn as a cursor on every array in scope.
 *
 * Returns Map<indexVarName, Set<containerName>>.
 */
export function buildIndexMap(source) {
  const map = new Map();
  const chain = /([A-Za-z_]\w*)((?:\s*\[[^\[\]]*\])+)/g;
  const inner = /\[\s*([A-Za-z_]\w*)\s*[\]\-+]/g;
  let match;
  while ((match = chain.exec(source)) !== null) {
    const container = match[1];
    let sub;
    inner.lastIndex = 0;
    while ((sub = inner.exec(match[2])) !== null) {
      const key = sub[1];
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(container);
    }
  }
  return map;
}

/**
 * Find integer variables acting as cursors into a sequence of `length`.
 *
 * A variable is drawn on a container when the source actually subscripts that
 * container with it. Failing any source evidence at all, a classic index name
 * (i, j, left, right, …) still gets the benefit of the doubt - that covers
 * `for i, n in enumerate(nums)`, where nums is never written as nums[i].
 */
export function collectPointers(locals, length, selfName, indexMap) {
  const pointers = [];
  for (const [name, snapshot] of Object.entries(locals)) {
    if (name === selfName) continue;
    if (snapshot?.kind !== 'scalar' || snapshot.t !== 'int') continue;
    const value = snapshot.value;
    if (!Number.isInteger(value)) continue;

    const evidence = indexMap?.get(name);
    if (evidence && evidence.size) {
      if (!evidence.has(selfName)) continue;
    } else if (!CLASSIC_INDEX.has(name.toLowerCase())) {
      continue;
    }

    const inRange = value >= 0 && value < Math.max(length, 1);
    const atEdge = value === length || value === -1;
    if (!inRange && !atEdge) continue;
    pointers.push({ name, index: value, color: colorFor(name), offscreen: !inRange });
  }
  return pointers.sort((a, b) => a.name.localeCompare(b.name));
}

/** Every node id reachable in a linked-list or tree snapshot. */
export function nodeIds(snapshot) {
  const ids = new Set();
  if (snapshot?.kind === 'linked_list') {
    for (const node of snapshot.nodes || []) ids.add(node.id);
  } else if (snapshot?.kind === 'tree') {
    (function walk(node) {
      if (!node) return;
      ids.add(node.id);
      walk(node.left);
      walk(node.right);
    })(snapshot.root);
  }
  return ids;
}

export function measureText(text, size = 12) {
  return Math.max(String(text).length * size * 0.62, size * 1.1);
}
