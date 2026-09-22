import { el, short } from '../util.js';

/**
 * Recursion view. Built from the call/return events up to the current step, so
 * backtracking problems show the shape of the search rather than a wall of lines.
 */
export function renderCallTree(frames, step) {
  const wrap = el('div', 'calltree');
  const open = [];
  const rows = [];

  for (let i = 0; i <= step && i < frames.length; i++) {
    const frame = frames[i];
    if (frame.event === 'call' && !frame.func.startsWith('<')) {
      const args = Object.entries(frame.locals)
        .map(([k, v]) => `${k}=${short(v)}`)
        .join(', ');
      const row = { depth: frame.depth, func: frame.func, args, ret: null, frameId: frame.frame };
      rows.push(row);
      open.push(row);
    } else if (frame.event === 'return') {
      for (let k = open.length - 1; k >= 0; k--) {
        if (open[k].frameId === frame.frame && open[k].ret === null) {
          open[k].ret = short(frame.ret);
          open.splice(k, 1);
          break;
        }
      }
    }
  }

  const current = frames[step];
  const visible = rows.slice(-120);

  for (const row of visible) {
    const line = el('div', 'ct-row');
    line.style.paddingLeft = `${6 + (row.depth - 1) * 16}px`;
    if (current && row.frameId === current.frame) line.classList.add('is-current');
    line.appendChild(el('span', 'ct-fn', row.func + '('));
    line.appendChild(el('span', 'ct-args', row.args));
    line.appendChild(el('span', 'ct-fn', ')'));
    if (row.ret !== null) line.appendChild(el('span', 'ct-ret', '→ ' + row.ret));
    wrap.appendChild(line);
  }

  if (!visible.length) wrap.appendChild(el('div', 'side-empty', 'No nested calls yet.'));
  return wrap;
}
