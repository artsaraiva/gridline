// The Asset keypad (#181; the Asset rail since #37): the cells pad.ts lays out in three bands under their rulers, top-left,
// drawn from the view and targeting (ready, cooling, at work, gated on the keystones still missing, armed, and the amber
// corner of a Squad's open Request); one readout line under the pad naming the hovered, focused or armed cell with its state;
// the Confirm row under it while an Asset is armed; the map Confirm button beside the target ring; and the keys, which arm
// the cell in their place. #142: an untargeted Asset (Rapid Deploy) arms straight to its Confirm row.
import { gridRef } from '../../sim/grid-ref';
import type { AssetKind, CommanderView, PointView, SideId, Vec2 } from '../../sim/types';
import { FOCUS_MARK_PX } from '../layers/effects';
import { assetLook, callable, markCount, PAD, ruler, spanPx, type CellLook, type PadCell } from '../pad';
import { pxToWorld, toScreen } from '../renderer';
import { session } from '../session';
import { arm, confirm, disarm, escape, placeConfirm, ready, strip, targeting } from '../targeting';
import { assetIcon, MARK_ICON, POINT_FRAME } from './icons';

const box = document.getElementById('assets')!;
const mapConfirm = document.getElementById('confirm') as HTMLButtonElement;

interface Cell {
  def: PadCell;
  el: HTMLElement;
  slot: HTMLElement;
  bar: HTMLElement;
}
const cells: Cell[] = [];
const pad = box.appendChild(document.createElement('div'));
pad.className = 'pad';
pad.setAttribute('role', 'group');
pad.setAttribute('aria-label', 'Assets');
for (let b = 0; PAD.some((c) => c.band === b); b++) {
  const band = pad.appendChild(document.createElement('div'));
  band.className = 'band';
  band.innerHTML = `<div class="ruler">${ruler(b)
    .map((r) => `<span style="width:${spanPx(r.span)}px"${r.span === 1 ? ' class="one"' : ''}><b>${r.category}</b><i></i></span>`)
    .join('')}</div><div class="cells"></div>`;
  const row = band.querySelector('.cells')!;
  for (const def of PAD.filter((c) => c.band === b)) {
    if (!def.calls) {
      const held = row.appendChild(document.createElement('div')); // a slot held for an Asset or standing action that has not shipped: it arms nothing
      held.className = 'cell held';
      held.dataset.key = def.key;
      held.setAttribute('aria-hidden', 'true');
      held.innerHTML = `<span class="key">${def.key}</span>`;
      continue;
    }
    const el = row.appendChild(document.createElement('button'));
    el.type = 'button';
    el.className = def.calls === 'mark' ? 'cell mark' : 'cell';
    el.dataset.key = def.key;
    el.setAttribute('aria-label', def.name);
    el.setAttribute('aria-keyshortcuts', def.key);
    el.innerHTML = `<span class="key">${def.key}</span><span class="ico">${def.calls === 'mark' ? MARK_ICON : assetIcon(def.calls)}</span><span class="slot"></span><i class="bar"></i>`;
    const asset = def.calls;
    if (asset !== 'mark') el.onclick = () => usable(asset) && arm(asset);
    cells.push({ def, el, slot: el.querySelector<HTMLElement>('.slot')!, bar: el.querySelector<HTMLElement>('.bar')! });
  }
}

const readout = box.appendChild(document.createElement('div'));
readout.className = 'readout';
readout.hidden = true;
readout.innerHTML = '<span class="nm"></span><span class="st"></span>';
const readName = readout.querySelector<HTMLElement>('.nm')!;
const readState = readout.querySelector<HTMLElement>('.st')!;

const cfRow = box.appendChild(document.createElement('div'));
cfRow.className = 'cfrow';
cfRow.hidden = true;
cfRow.innerHTML = '<button type="button" class="cf"><span></span><small>Esc cancels</small></button><button type="button" class="cx" aria-label="Cancel">✕</button>';
const cf = cfRow.querySelector<HTMLButtonElement>('.cf')!;
cf.onclick = confirm;
cfRow.querySelector<HTMLButtonElement>('.cx')!.onclick = disarm;
mapConfirm.onclick = confirm;

/** The pad's cell for `calls`: chrome/mark.ts runs the Mark's. */
export const cellOf = (calls: AssetKind | 'mark') => cells.find((c) => c.def.calls === calls)!.el;

let last: CommanderView | null = null;
const usable = (asset: AssetKind) => !!last && callable(asset, last);

document.addEventListener('keydown', (e) => {
  if (!last || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return; // a mixer slider has focus
  if (e.key === 'Escape') return escape();
  const asset = PAD.find((c) => c.key === e.key.toUpperCase())?.calls; // a held slot calls nothing; the Mark's key is chrome/mark.ts's
  if (asset && asset !== 'mark' && usable(asset)) arm(asset);
});

const grid = (p: Vec2) => {
  const g = session.host?.map.grid;
  return g ? gridRef(g, p) : '';
};

/** #181: a keystone Capture Point still missing, in its holder's frame and colour, as the score strip draws it (heavier, for 15 px). */
function keystoneFrame(p: PointView, us: SideId): string {
  const own = p.owner === null ? 'ne' : p.owner === us ? 'fr' : 'ho';
  return `<svg viewBox="0 0 28 28" aria-hidden="true" style="color:var(--${own === 'ne' ? 'bone' : own})"><g fill="rgba(5,9,11,.6)" stroke="currentColor" stroke-width="2.4">${POINT_FRAME[own]}</g><text x="14" y="15" fill="currentColor" font-family="Chakra Petch" font-weight="700" font-size="15" text-anchor="middle" dominant-baseline="middle">${p.name}</text></svg>`;
}

/** Sets `el`'s class, markup or attributes only on change, so a blink keeps its phase and nothing is rebuilt each frame. */
function put(el: HTMLElement, cls: string | null, html: string | null, attrs: Record<string, string> = {}) {
  if (cls !== null && el.className !== cls) el.className = cls;
  if (html !== null && el.dataset.h !== html) el.innerHTML = el.dataset.h = html;
  for (const [k, v] of Object.entries(attrs)) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
}

/** The pad for `view`, or hidden between matches; then the readout, the Confirm row and the map Confirm button. */
export function drawAssetRail(view: CommanderView | null) {
  last = view;
  box.hidden = !view;
  if (targeting.armed && !usable(targeting.armed)) disarm(); // between matches, at the end, or once it can't be called (a keystone lost; #101 a Gunship off station)
  const spot = targeting.spot ?? targeting.pointer;
  const at = spot ? grid(spot) : '';
  const looks = new Map<Cell, CellLook>();
  for (const c of cells) {
    const asset = c.def.calls;
    if (!view || !asset || asset === 'mark') continue;
    const look = assetLook(asset, view, targeting.armed === asset, at);
    looks.set(c, look);
    put(c.el, `cell ${look.state}${look.lift ? ' lift' : ''}${look.request ? ' req' : ''}`, null, { 'aria-disabled': String(look.state === 'off'), 'aria-pressed': String(look.state === 'armed') });
    put(c.slot, null, look.needs.length ? look.needs.map((p) => keystoneFrame(p, view.side)).join('') : look.slot);
    c.bar.style.width = `${(100 * look.bar).toFixed(2)}%`;
  }
  // The readout names the armed cell (the Mark's in Mark mode), else the one under the pointer or the keyboard focus
  const armed = targeting.armed ?? (targeting.marking ? 'mark' : null);
  const hot = (armed && cells.find((c) => c.def.calls === armed)) || cells.find((c) => c.el.matches(':hover, :focus-visible'));
  readout.hidden = !view || !hot;
  if (view && hot) {
    const look = looks.get(hot); // none for the Mark
    const named = hot.def.calls === armed; // armed: the name alone
    put(readName, null, hot.def.name);
    put(readState, look?.request && !named ? 'st rq' : 'st', named ? '' : !look ? markCount(view) : `${look.readout}${look.needs.map((p) => keystoneFrame(p, view.side)).join('')}`);
  }
  cfRow.hidden = !targeting.armed;
  if (targeting.armed) {
    cf.disabled = !ready();
    put(cf.querySelector('span')!, null, !ready() ? (targeting.spot ? 'Tap the direction' : 'Tap the map') : targeting.spot ? `Confirm ${grid(targeting.spot)}` : 'Confirm'); // #138: a line-shaped Asset takes a second tap; #142 an untargeted one none
  }
  placeMapConfirm(view);
}

function placeMapConfirm(view: CommanderView | null) {
  const { armed, spot } = targeting;
  const radius = armed && view?.assets?.find((a) => a.asset === armed)?.radius;
  mapConfirm.hidden = !spot || !radius || !ready();
  if (!spot || !radius || !ready()) return;
  mapConfirm.querySelector('span')!.textContent = `Confirm ${grid(spot)}`;
  const line = strip(null);
  const c = toScreen(line && !line.across ? line.to : spot); // #138: at the far end of a strip, clear of the start; #139 by the start of one that runs off the map
  const panels = [...document.querySelectorAll('[data-hit]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  const at = placeConfirm({ ...c, r: armed === 'gunship' ? FOCUS_MARK_PX : radius / pxToWorld() }, { w: mapConfirm.offsetWidth, h: mapConfirm.offsetHeight }, { w: innerWidth, h: innerHeight }, panels);
  mapConfirm.style.left = `${at.x}px`;
  mapConfirm.style.top = `${at.y}px`;
}
