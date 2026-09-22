import { el, fmt, collectPointers } from '../util.js';

/**
 * 2D lists: DP tables, island maps, matrices. Two in-range integer locals become
 * the active (row, col), which is what makes a DP fill order legible.
 */
export function renderGrid(name, snapshot, ctx) {
  const rows = snapshot.rows || [];
  const height = snapshot.h, width = snapshot.w;

  const rowPtrs = collectPointers(ctx.locals, height, name, ctx.indexMap);
  const colPtrs = collectPointers(ctx.locals, width, name, ctx.indexMap);
  const activeRow = pick(rowPtrs, ['r', 'i', 'row', 'y']);
  const activeCol = pick(colPtrs, ['c', 'j', 'col', 'x']);

  const prevRows = ctx.prevSnapshot?.kind === 'grid' ? ctx.prevSnapshot.rows : null;

  const table = el('table', 'grid-table');

  const headRow = el('tr');
  headRow.appendChild(el('th', null, ''));
  for (let c = 0; c < width; c++) headRow.appendChild(el('th', null, c));
  table.appendChild(headRow);

  rows.forEach((row, r) => {
    const tr = el('tr');
    tr.appendChild(el('th', null, r));
    row.forEach((value, c) => {
      const td = el('td', null, fmt(value));
      if (prevRows && JSON.stringify(prevRows[r]?.[c]) !== JSON.stringify(value)) {
        td.classList.add('is-changed');
      }
      if (activeRow !== null && activeCol !== null && r === activeRow && c === activeCol) {
        td.classList.add('is-active');
      }
      if (value === 0 || value === '0' || value === false) td.classList.add('is-dim');
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  const wrap = el('div', 'svg-wrap');
  wrap.appendChild(table);
  if (activeRow !== null && activeCol !== null) {
    wrap.appendChild(el('div', 'cell-idx', `active cell: [${activeRow}][${activeCol}]`));
  }
  return wrap;
}

/** 1D DP arrays are handled by the array renderer; this is for row-of-rows only. */
function pick(pointers, preferred) {
  for (const name of preferred) {
    const hit = pointers.find(p => p.name.toLowerCase() === name && !p.offscreen);
    if (hit) return hit.index;
  }
  const inRange = pointers.filter(p => !p.offscreen);
  return inRange.length ? inRange[0].index : null;
}
