import { el, short, fmt } from '../util.js';

/** dict: key|value tiles, with newly written keys flagged. */
export function renderMap(name, snapshot, ctx) {
  const wrap = el('div', 'tiles');
  const prevKeys = new Map(
    (ctx.prevSnapshot?.entries || []).map(([k, v]) => [String(k), JSON.stringify(v)])
  );

  for (const [key, value] of snapshot.entries) {
    const tile = el('div', 'tile');
    tile.appendChild(el('div', 'tk', fmt(key)));
    tile.appendChild(el('div', 'tv', short(value)));
    const before = prevKeys.get(String(key));
    if (ctx.prevSnapshot && before !== JSON.stringify(value)) tile.classList.add('is-changed');
    wrap.appendChild(tile);
  }
  if (!snapshot.entries.length) wrap.appendChild(el('div', 'cell is-null', '{}'));
  return wrap;
}

/** set: single-cell tiles. */
export function renderSet(name, snapshot, ctx) {
  const wrap = el('div', 'tiles');
  const before = new Set((ctx.prevSnapshot?.items || []).map(String));
  for (const item of snapshot.items) {
    const tile = el('div', 'tile tile-solo', fmt(item));
    if (ctx.prevSnapshot && !before.has(String(item))) tile.classList.add('is-changed');
    wrap.appendChild(tile);
  }
  if (!snapshot.items.length) wrap.appendChild(el('div', 'cell is-null', 'set()'));
  return wrap;
}
