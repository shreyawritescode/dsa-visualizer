import { el, short, fmt, collectPointers } from '../util.js';

/** Arrays and strings: a row of cells with index labels and pointer flags. */
export function renderArray(name, snapshot, ctx) {
  const isString = snapshot.kind === 'string';
  const items = isString
    ? snapshot.chars.map(ch => ({ kind: 'string', value: ch, chars: [ch] }))
    : snapshot.items;

  const pointers = collectPointers(ctx.locals, items.length, name, ctx.indexMap);
  const byIndex = new Map();
  for (const ptr of pointers) {
    if (!byIndex.has(ptr.index)) byIndex.set(ptr.index, []);
    byIndex.get(ptr.index).push(ptr);
  }

  // A two-pointer window: shade everything between the lowest and highest pointer.
  let windowRange = null;
  if (pointers.length >= 2) {
    const inside = pointers.filter(p => !p.offscreen).map(p => p.index);
    if (inside.length >= 2) windowRange = [Math.min(...inside), Math.max(...inside)];
  }

  const row = el('div', 'cells');
  const prev = ctx.prevSnapshot;
  const prevItems = prev && prev.kind === snapshot.kind
    ? (prev.kind === 'string' ? prev.chars : prev.items) : null;

  items.forEach((item, index) => {
    const wrap = el('div', 'cell-wrap');

    const flags = el('div', 'ptr-stack');
    for (const ptr of byIndex.get(index) || []) {
      const tag = el('div', 'ptr-tag', ptr.name);
      tag.style.background = ptr.color;
      flags.appendChild(tag);
    }
    wrap.appendChild(flags);

    const text = isString ? (item.value ?? '') : short(item);
    const cell = el('div', 'cell', text);
    if (text === 'None') cell.classList.add('is-null');

    // Compare like with like: raw characters for strings, snapshots for arrays.
    if (prevItems !== null && index < Math.max(prevItems.length, items.length)) {
      const before = prevItems[index];
      const now = isString ? item.value : item;
      const changedHere = isString
        ? before !== now
        : JSON.stringify(before) !== JSON.stringify(now);
      if (changedHere) cell.classList.add('is-changed');
    }
    if (byIndex.has(index)) cell.classList.add('is-pointed');
    if (windowRange && index > windowRange[0] && index < windowRange[1] && !byIndex.has(index)) {
      cell.classList.add('is-window');
    }

    wrap.appendChild(cell);
    wrap.appendChild(el('div', 'cell-idx', index));
    row.appendChild(wrap);
  });

  if (!items.length) row.appendChild(el('div', 'cell is-null', isString ? '""' : 'empty'));

  const offscreen = pointers.filter(p => p.offscreen);
  if (offscreen.length) {
    const note = el('div', 'cell-idx', offscreen.map(p => `${p.name}=${p.index}`).join('  ') + ' (out of range)');
    note.style.marginTop = '6px';
    const box = el('div');
    box.appendChild(row);
    box.appendChild(note);
    return box;
  }
  return row;
}

/** Stack view: same data, drawn as a column with the top called out. */
export function renderStack(name, snapshot, ctx) {
  const items = snapshot.items || [];
  const wrap = el('div', 'stack-col');
  items.forEach((item, index) => {
    const row = el('div', 'stack-row');
    const cell = el('div', 'cell', short(item));
    if (index === items.length - 1) {
      cell.classList.add('is-pointed');
      row.appendChild(cell);
      row.appendChild(el('span', 'stack-label', 'top'));
    } else {
      row.appendChild(cell);
    }
    wrap.appendChild(row);
  });
  if (!items.length) wrap.appendChild(el('div', 'cell is-null', 'empty'));
  return wrap;
}

/** deque: horizontal with front/back labels. */
export function renderQueue(name, snapshot, ctx) {
  const items = snapshot.items || [];
  const row = el('div', 'cells');
  if (items.length) row.appendChild(el('span', 'stack-label', 'front'));
  items.forEach(item => {
    const wrap = el('div', 'cell-wrap');
    wrap.appendChild(el('div', 'ptr-stack'));
    wrap.appendChild(el('div', 'cell', short(item)));
    row.appendChild(wrap);
  });
  if (items.length) row.appendChild(el('span', 'stack-label', 'back'));
  else row.appendChild(el('div', 'cell is-null', 'empty'));
  return row;
}
