// Left rail Asset rows (hotkey, icon, name, timer, bar), the Confirm row under the armed Asset, the map Confirm button
// beside the target ring, and the Asset hotkeys. Rows read ready, cooling, active or armed from the view and targeting.
// #44 owns the rail's look; this is the behaviour.
import { gridRef } from '../../sim/grid-ref';
import { MISSILE_ICON } from './icons';
import type { AssetKind, CommanderView, Vec2 } from '../../sim/types';
import { pxToWorld, toScreen } from '../renderer';
import { session } from '../session';
import { clock } from '../summary';
import { arm, confirm, disarm, escape, placeConfirm, targeting } from '../targeting';

const icon = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;
const ROWS: { key: string; asset: AssetKind; name: string; icon: string }[] = [
  { key: 'Q', asset: 'scan', name: 'Scan UAV', icon: icon('<path d="M12 2.5v18.5M2.5 11l9.5-1.8 9.5 1.8M8.3 19.8h7.4"/><circle cx="12" cy="9.4" r="1.1" fill="currentColor"/>') },
  { key: 'W', asset: 'supply', name: 'Supply Drop', icon: icon('<path d="M3.5 10a8.5 6.5 0 0 1 17 0Zm0 0 6.3 5.6m10.7-5.6-6.3 5.6M12 10v5.6"/><path d="M8.6 15.6h6.8v5.4H8.6z"/><path d="M8.6 18.3h6.8"/>') },
  { key: 'E', asset: 'barrage', name: 'Artillery Barrage', icon: icon('<path d="M5.5 3.5l1.6 3v8H3.9v-8z M12 6.5l1.6 3v8h-3.2v-8z M18.5 3.5l1.6 3v8h-3.2v-8z"/><path d="M3.5 18.5h17M5 21h14"/>') },
  { key: 'R', asset: 'missile', name: 'Cruise Missile', icon: icon(MISSILE_ICON) },
];

const box = document.getElementById('assets')!;
const mapConfirm = document.getElementById('confirm') as HTMLButtonElement;
const rows = ROWS.map((r) => {
  const row = document.createElement('button');
  row.className = 'asset';
  row.innerHTML = `<span class="key">${r.key}</span><span class="ico">${r.icon}</span><span class="lbl"><span>${r.name}</span><span class="t"></span><i class="bar"></i></span>`;
  row.onclick = () => usable(r.asset) && arm(r.asset);
  const cf = document.createElement('div');
  cf.className = 'cfrow';
  cf.innerHTML = '<button class="cf"><span></span><small>Esc cancels</small></button><button class="cx" aria-label="Cancel">✕</button>';
  cf.querySelector<HTMLButtonElement>('.cf')!.onclick = confirm;
  cf.querySelector<HTMLButtonElement>('.cx')!.onclick = disarm;
  box.append(row, cf);
  return { ...r, row, cf, timer: row.querySelector<HTMLElement>('.t')!, bar: row.querySelector<HTMLElement>('.bar')! };
});
mapConfirm.onclick = confirm;

let last: CommanderView | null = null;
const usable = (asset: AssetKind) => {
  const a = last?.assets?.find((a) => a.asset === asset);
  return !!last && !last.result && !!a && a.readyIn === 0 && !a.off;
};

document.addEventListener('keydown', (e) => {
  if (!last || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return; // a mixer slider has focus
  if (e.key === 'Escape') return escape();
  const r = ROWS.find((r) => r.key === e.key.toUpperCase());
  if (r && usable(r.asset)) arm(r.asset);
});

const grid = (p: Vec2) => {
  const g = session.host?.map.grid;
  return g ? gridRef(g, p) : '';
};

/** The rows for `view`, or hidden between matches; then the map Confirm button. */
export function drawAssetRail(view: CommanderView | null) {
  last = view;
  box.hidden = !view;
  if (!view || view.result) disarm();
  for (const r of rows) {
    const a = view?.assets?.find((a) => a.asset === r.asset);
    const fx = view?.effects?.filter((e) => e.asset === r.asset && (e.side ?? view.side) === view.side).sort((p, q) => q.left - p.left)[0]; // #99: not the enemy's missile
    const armed = targeting.armed === r.asset;
    const state = !a || a.off ? 'off' : armed ? 'armed' : fx ? 'active' : a.readyIn > 0 ? 'cooling' : 'ready';
    const cls = `asset ${state}`;
    if (r.row.className !== cls) r.row.className = cls; // only on change, so the blink keeps its phase
    r.row.disabled = state === 'off';
    const spot = targeting.spot ?? targeting.pointer;
    r.timer.textContent =
      state === 'off' ? (a?.off ?? '—') : state === 'armed' ? (spot ? grid(spot) : '') : fx ? `Up ${clock(Math.ceil(fx.left))}` : a!.readyIn > 0 ? clock(Math.ceil(a!.readyIn)) : 'Ready';
    r.bar.style.width = fx ? `${(100 * fx.left) / fx.total}%` : a && a.readyIn > 0 ? `${(100 * a.readyIn) / a.cooldown}%` : '0'; // #99: an off row's cooldown still drains
    r.cf.hidden = !armed;
    if (!armed) continue;
    const cf = r.cf.querySelector<HTMLButtonElement>('.cf')!;
    cf.disabled = !targeting.spot;
    cf.querySelector('span')!.textContent = targeting.spot ? `Confirm ${grid(targeting.spot)}` : 'Tap the map';
  }
  placeMapConfirm(view);
}

function placeMapConfirm(view: CommanderView | null) {
  const { armed, spot } = targeting;
  const radius = armed && view?.assets?.find((a) => a.asset === armed)?.radius;
  mapConfirm.hidden = !spot || !radius;
  if (!spot || !radius) return;
  mapConfirm.querySelector('span')!.textContent = `Confirm ${grid(spot)}`;
  const c = toScreen(spot);
  const panels = [...document.querySelectorAll('[data-hit]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  const at = placeConfirm({ ...c, r: radius / pxToWorld() }, { w: mapConfirm.offsetWidth, h: mapConfirm.offsetHeight }, { w: innerWidth, h: innerHeight }, panels);
  mapConfirm.style.left = `${at.x}px`;
  mapConfirm.style.top = `${at.y}px`;
}
