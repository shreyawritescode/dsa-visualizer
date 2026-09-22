import { el, svg, fmt, colorFor } from '../util.js';

const W = 56, H = 38, GAP = 36, ROW = 92, PAD = 14, PER_ROW = 8;

/**
 * Linked list. Other locals that are themselves linked-list snapshots get drawn
 * as pointers, so `prev` / `curr` / `slow` / `fast` label the node they sit on -
 * which is the whole point of watching a pointer-manipulation problem.
 */
export function renderLinkedList(name, snapshot, ctx) {
  const nodes = snapshot.nodes || [];
  if (!nodes.length) return el('div', 'cell is-null', 'None');

  // The caller may have worked out the pointers already (it can see every frame);
  // fall back to reading this frame's locals when it has not.
  const pointers = ctx.nodePointers ?? new Map();
  if (!ctx.nodePointers) {
    for (const [varName, snap] of Object.entries(ctx.locals)) {
      if (varName === name) continue;
      if (snap?.kind !== 'linked_list' || !snap.nodes?.length) continue;
      const headId = snap.nodes[0].id;
      if (!pointers.has(headId)) pointers.set(headId, []);
      pointers.get(headId).push(varName);
    }
  }

  const rows = Math.ceil(nodes.length / PER_ROW);
  const width = PAD * 2 + Math.min(nodes.length, PER_ROW) * (W + GAP);
  const height = PAD * 2 + rows * ROW;

  const root = svg('svg', { class: 'viz', width, height, viewBox: `0 0 ${width} ${height}` });
  root.appendChild(arrowMarker());

  const pos = nodes.map((_, index) => ({
    x: PAD + (index % PER_ROW) * (W + GAP),
    y: PAD + 26 + Math.floor(index / PER_ROW) * ROW,
  }));

  nodes.forEach((node, index) => {
    const { x, y } = pos[index];

    const box = svg('rect', {
      x, y, width: W, height: H, rx: 8,
      class: 'node-box',
      style: 'fill: var(--panel-2); stroke: var(--line); stroke-width: 1.5',
    });
    const names = pointers.get(node.id);
    if (names) box.setAttribute('style', 'fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2');
    root.appendChild(box);

    const label = svg('text', { x: x + W / 2, y: y + H / 2, class: 'node-label' });
    label.textContent = fmt(node.val);
    root.appendChild(label);

    if (names) {
      names.forEach((varName, k) => {
        const tag = svg('text', { x: x + W / 2, y: y - 8 - k * 13, class: 'ptr-label',
                                  style: `fill: ${colorFor(varName)}` });
        tag.textContent = '↓ ' + varName;
        root.appendChild(tag);
      });
    }

    // edge to the next node
    if (node.next !== null && node.next !== undefined) {
      const to = pos[node.next];
      if (!to) return;
      const sameRow = Math.abs(to.y - y) < 1 && to.x > x;
      if (sameRow) {
        root.appendChild(svg('line', {
          x1: x + W, y1: y + H / 2, x2: to.x - 5, y2: y + H / 2,
          style: 'stroke: var(--text-3); stroke-width: 1.6',
          'marker-end': 'url(#arrow)',
        }));
      } else {
        const midY = Math.max(y, to.y) + H + 14;
        root.appendChild(svg('path', {
          d: `M ${x + W / 2} ${y + H} L ${x + W / 2} ${midY} L ${to.x + W / 2} ${midY} L ${to.x + W / 2} ${to.y + H + 5}`,
          style: 'stroke: var(--accent); stroke-width: 1.6; fill: none; stroke-dasharray: 4 3',
          'marker-end': 'url(#arrow)',
        }));
      }
    } else {
      const nil = svg('text', { x: x + W + GAP / 2, y: y + H / 2, class: 'edge-label' });
      nil.textContent = '∅';
      root.appendChild(nil);
      root.appendChild(svg('line', {
        x1: x + W, y1: y + H / 2, x2: x + W + GAP / 2 - 9, y2: y + H / 2,
        style: 'stroke: var(--text-3); stroke-width: 1.6',
        'marker-end': 'url(#arrow)',
      }));
    }
  });

  const wrap = el('div', 'svg-wrap');
  wrap.appendChild(root);
  if (snapshot.cycle_to !== null && snapshot.cycle_to !== undefined) {
    wrap.appendChild(el('div', 'cell-idx', `cycle: last node points back to index ${snapshot.cycle_to}`));
  }
  return wrap;
}

export function arrowMarker() {
  const defs = svg('defs');
  const marker = svg('marker', {
    id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse',
  });
  marker.appendChild(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', style: 'fill: var(--text-3)' }));
  defs.appendChild(marker);
  return defs;
}
