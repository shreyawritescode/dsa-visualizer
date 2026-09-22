import { el, svg, fmt, colorFor } from '../util.js';

const R = 18, LEVEL = 64, XGAP = 44, PAD = 24;

/** Binary tree. In-order x placement keeps left/right honest and never overlaps. */
export function renderTree(name, snapshot, ctx) {
  if (!snapshot.root) return el('div', 'cell is-null', 'None');

  const placed = [];
  let cursor = 0;

  (function place(node, depth) {
    if (!node) return;
    place(node.left, depth + 1);
    placed.push({ node, depth, x: PAD + cursor * XGAP + R, y: PAD + depth * LEVEL + R });
    cursor += 1;
    place(node.right, depth + 1);
  })(snapshot.root, 0);

  const byId = new Map(placed.map(p => [p.node.id, p]));
  const maxDepth = Math.max(...placed.map(p => p.depth));
  const width = PAD * 2 + cursor * XGAP;
  const height = PAD * 2 + maxDepth * LEVEL + R * 2 + 10;

  const pointers = ctx.nodePointers ?? new Map();
  if (!ctx.nodePointers) {
    for (const [varName, snap] of Object.entries(ctx.locals)) {
      if (varName === name) continue;
      if (snap?.kind !== 'tree' || !snap.root) continue;
      const id = snap.root.id;
      if (!pointers.has(id)) pointers.set(id, []);
      pointers.get(id).push(varName);
    }
  }

  const root = svg('svg', { class: 'viz', width, height, viewBox: `0 0 ${width} ${height}` });

  // edges first so nodes draw on top
  for (const { node, x, y } of placed) {
    for (const child of [node.left, node.right]) {
      const target = child && byId.get(child.id);
      if (!target) continue;
      root.appendChild(svg('line', {
        x1: x, y1: y + R - 2, x2: target.x, y2: target.y - R + 2,
        style: 'stroke: var(--line); stroke-width: 1.8',
      }));
    }
  }

  for (const { node, x, y } of placed) {
    const names = pointers.get(node.id);
    const circle = svg('circle', {
      cx: x, cy: y, r: R, class: 'node-box',
      style: names
        ? 'fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2.4'
        : 'fill: var(--panel-2); stroke: var(--line); stroke-width: 1.8',
    });
    root.appendChild(circle);

    const label = svg('text', { x, y, class: 'node-label' });
    label.textContent = fmt(node.val);
    root.appendChild(label);

    if (names) {
      names.forEach((varName, k) => {
        const tag = svg('text', { x, y: y - R - 7 - k * 13, class: 'ptr-label',
                                  style: `fill: ${colorFor(varName)}` });
        tag.textContent = varName;
        root.appendChild(tag);
      });
    }
  }

  const wrap = el('div', 'svg-wrap');
  wrap.appendChild(root);
  if (snapshot.truncated) wrap.appendChild(el('div', 'cell-idx', 'tree truncated for display'));
  return wrap;
}
