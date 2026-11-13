// The Mark button (#136), under the Asset rows: a standing action, so no cooldown and no Confirm. It turns Mark mode on and
// off (so does F: M is the mixer's mute; Esc leaves it); targeting.ts turns the taps into Mark Commands.
import { gridRef } from '../../sim/grid-ref';
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView } from '../../sim/types';
import { session } from '../session';
import { markMode, targeting } from '../targeting';

const row = document.createElement('button');
row.className = 'asset mark';
row.innerHTML =
  '<span class="key">F</span><span class="ico"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2 22 12 12 22 2 12Z"/><text x="12" y="16.6" text-anchor="middle" font-size="13" font-weight="700">?</text></svg></span><span class="lbl"><span>Mark</span><span class="t"></span></span>';
row.onclick = () => live && markMode(!targeting.marking);
document.getElementById('assets')!.append(row);
const timer = row.querySelector<HTMLElement>('.t')!;

let live = false; // a match is running
document.addEventListener('keydown', (e) => {
  if (!live || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key.toUpperCase() !== 'F') return;
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return; // a mixer slider has focus
  markMode(!targeting.marking);
});

/** The button for `view`: how many Marks are live, or in Mark mode the Grid Reference under the pointer. */
export function drawMark(view: CommanderView | null) {
  live = !!view && !view.result;
  if (!live) markMode(false);
  const cls = `asset mark ${targeting.marking ? 'armed' : 'ready'}`;
  if (row.className !== cls) row.className = cls; // only on change, so the blink keeps its phase
  const grid = session.host?.map.grid;
  timer.textContent = targeting.marking ? (targeting.pointer && grid ? gridRef(grid, targeting.pointer) : 'Tap the map') : `${view?.marks?.length ?? 0}/${DEFAULT_TUNE.markMax}`;
}
