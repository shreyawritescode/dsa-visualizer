import { el, svg, fmt } from '../util.js';

const R = 19, LEVEL = 62, PAD = 20;

/** A heap is an array; drawing it as the complete binary tree it represents. */
export function renderHeap(name, snapshot, ctx) {
  const items = snapshot.items || [];
  if (!items.length) return el('div', 'cell is-null', 'empty heap');

  const depth = Math.floor(Math.log2(items.length)) + 1;
  const leafCount = Math.pow(2, depth - 1);
  const width = PAD * 2 + leafCount * 52;
  const height = PAD * 2 + (depth - 1) * LEVEL + R * 2;

  const pos = items.map((_, index) => {
    const level = Math.floor(Math.log2(index + 1));
    const indexInLevel = index - (Math.pow(2, level) - 1);
    const slots = Math.pow(2, level);
    const span = (width - PAD * 2) / slots;
    return { x: PAD + span * (indexInLevel + 0.5), y: PAD + level * LEVEL + R };
  });

  const root = svg('svg', { class: 'viz', width, height, viewBox: `0 0 ${width} ${height}` });

  items.forEach((_, index) => {
    for (const child of [2 * index + 1, 2 * index + 2]) {
      if (child >= items.length) continue;
      root.appendChild(svg('line', {
        x1: pos[index].x, y1: pos[index].y + R - 2,
        x2: pos[child].x, y2: pos[child].y - R + 2,
        style: 'stroke: var(--line); stroke-width: 1.8',
      }));
    }
  });

  items.forEach((value, index) => {
    root.appendChild(svg('circle', {
      cx: pos[index].x, cy: pos[index].y, r: R, class: 'node-box',
      style: index === 0
        ? 'fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2.4'
        : 'fill: var(--panel-2); stroke: var(--line); stroke-width: 1.8',
    }));
    const label = svg('text', { x: pos[index].x, y: pos[index].y, class: 'node-label' });
    label.textContent = fmt(value);
    root.appendChild(label);

    const idx = svg('text', { x: pos[index].x, y: pos[index].y + R + 11, class: 'edge-label' });
    idx.textContent = index;
    root.appendChild(idx);
  });

  const wrap = el('div', 'svg-wrap');
  wrap.appendChild(root);
  wrap.appendChild(el('div', 'cell-idx', 'root (index 0) is the min for a heapq min-heap'));
  return wrap;
}
