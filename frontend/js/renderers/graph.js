import { el, svg, fmt } from '../util.js';
import { arrowMarker } from './linkedlist.js';

const R = 21, PAD = 30;

/** Adjacency dict drawn on a circle - readable up to ~20 nodes without physics. */
export function renderGraph(name, snapshot, ctx) {
  const nodes = snapshot.nodes || [];
  if (!nodes.length) return el('div', 'cell is-null', 'empty graph');

  const radius = Math.max(70, nodes.length * 15);
  const size = (radius + PAD + R) * 2;
  const centre = size / 2;

  const pos = new Map();
  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(String(node), { x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle) });
  });

  const root = svg('svg', { class: 'viz', width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  root.appendChild(arrowMarker());

  for (const [from, to] of snapshot.edges || []) {
    const a = pos.get(String(from));
    const b = pos.get(String(to));
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    root.appendChild(svg('line', {
      x1: a.x + (dx / dist) * R, y1: a.y + (dy / dist) * R,
      x2: b.x - (dx / dist) * (R + 5), y2: b.y - (dy / dist) * (R + 5),
      style: 'stroke: var(--line); stroke-width: 1.6',
      'marker-end': 'url(#arrow)',
    }));
  }

  for (const node of nodes) {
    const { x, y } = pos.get(String(node));
    root.appendChild(svg('circle', {
      cx: x, cy: y, r: R, class: 'node-box',
      style: 'fill: var(--panel-2); stroke: var(--line); stroke-width: 1.8',
    }));
    const label = svg('text', { x, y, class: 'node-label' });
    label.textContent = fmt(node);
    root.appendChild(label);
  }

  const wrap = el('div', 'svg-wrap');
  wrap.appendChild(root);
  return wrap;
}
