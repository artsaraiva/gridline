// The Mark (#136), the V cell of the Asset keypad's third band (#181): a standing action, so no cooldown and no Confirm. It
// turns Mark mode on and off (so does its key; M is the mixer's mute; Esc leaves it); targeting.ts turns the taps into Mark
// Commands. chrome/assets.ts lays the cell out and names it in the readout.
import { gridRef } from '../../sim/grid-ref';
import type { CommanderView } from '../../sim/types';
import { markCount, PAD } from '../pad';
import { session } from '../session';
import { markMode, targeting } from '../targeting';
import { cellOf } from './assets';

const KEY = PAD.find((c) => c.calls === 'mark')!.key;
const cell = cellOf('mark');
const slot = cell.querySelector<HTMLElement>('.slot')!;
cell.onclick = () => live && markMode(!targeting.marking);

let live = false; // a match is running
document.addEventListener('keydown', (e) => {
  if (!live || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key.toUpperCase() !== KEY) return;
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return; // a mixer slider has focus
  markMode(!targeting.marking);
});

/** The cell for `view`: how many Marks are live, or in Mark mode the Grid Reference under the pointer. */
export function drawMark(view: CommanderView | null) {
  live = !!view && !view.result;
  if (!live) markMode(false);
  const cls = `cell mark lift ${targeting.marking ? 'armed' : 'ready'}`;
  if (cell.className !== cls) cell.className = cls; // only on change, so the blink keeps its phase
  if (cell.getAttribute('aria-pressed') !== String(targeting.marking)) cell.setAttribute('aria-pressed', String(targeting.marking));
  const grid = session.host?.map.grid;
  const text = targeting.marking ? (targeting.pointer && grid ? gridRef(grid, targeting.pointer) : '') : view ? markCount(view) : '';
  if (slot.textContent !== text) slot.textContent = text;
}
