// The score strip top-centre (Capture Point badges with capture arcs between the two Sides' Tickets and bars, the clock
// under them, a mark on the Side that is draining), the contribution messages under the Asset rail (#72), and right-side
// toasts on major radio events. `chrome/assets.ts` owns the Asset rail itself.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView, PointView, SideId, SimEvent } from '../../sim/types';
import { session } from '../session';
import { awardLine, clock, drainingSide, FACTION } from '../summary';

/** Chrome geometry in px, which frames the map (`fitView`) and places its grid labels. `console.css` sizes the same boxes:
 * `margin` is every panel's inset, `assetRail` the `.asset` icon cell, `squadRail` the `.tile`, `top` clears the score strip
 * and the grid letters under it, `bottom` the cursor readout, `gridLabels` the numbers left of the map. */
export const LAYOUT = { margin: 16, assetRail: 40, squadRail: 56, gap: 16, gridLabels: 26, top: 92, bottom: 44 };

const rail = document.getElementById('rail')!;
const score = document.getElementById('score')!;
const awards = document.getElementById('awards')!;
const toastEl = document.getElementById('toast')!;
const toastTitle = toastEl.querySelector('div')!;
const toastSub = toastEl.querySelector('small')!;

function pointBadge(p: PointView, us: SideId): string {
  const own = p.owner === null ? 'ne' : p.owner === us ? 'fr' : 'ho';
  const col = own === 'fr' ? 'var(--fr)' : own === 'ho' ? 'var(--ho)' : 'var(--bone)';
  const shape =
    own === 'fr'
      ? '<rect x="3" y="3" width="22" height="22"/>'
      : own === 'ho'
        ? '<path d="M14 0.5 27.5 14 14 27.5 0.5 14z"/>'
        : '<circle cx="14" cy="14" r="11.5"/>';
  const cap = Math.abs(p.progress);
  const arcCol = (p.progress > 0 ? 'nato' : 'pact') === us ? 'var(--fr)' : 'var(--ho)';
  const arc =
    cap > 0 && cap < 1
      ? `<circle cx="14" cy="14" r="15.5" stroke="${arcCol}" stroke-width="2.2" fill="none" stroke-dasharray="${(cap * 97.4).toFixed(1)} 97.4" transform="rotate(-90 14 14)"/>`
      : '';
  return `<svg viewBox="0 0 28 28" style="color:${col}"><g fill="rgba(5,9,11,.6)" stroke="currentColor" stroke-width="1.8">${shape}</g>${arc}<text x="14" y="15" fill="currentColor" font-family="Chakra Petch" font-weight="700" font-size="13" text-anchor="middle" dominant-baseline="middle">${p.name}</text></svg>`;
}

/** Shows a toast right of centre beside the Squad rail. */
export function showToast(title: string, sub: string) {
  toastEl.hidden = false;
  toastTitle.textContent = title;
  toastSub.textContent = sub;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
}

/** #72: shows an award as a contribution message under the Asset rail for a few seconds. */
export function showAward(e: SimEvent, view: CommanderView) {
  const line = awardLine(e, view);
  if (!line) return;
  const row = awards.appendChild(document.createElement('div'));
  row.className = 'award';
  row.textContent = line;
  row.onanimationend = () => row.remove();
}

/** Fires a toast on notable own-Side radio events (Asset called, point captured/lost, Squad wiped, Request). */
export function toastEvent(e: SimEvent, view: CommanderView) {
  if (e.side !== view.side || e.kind !== 'radio') return;
  if (e.type === 'asset') showToast(e.text, e.grid ? `Grid ${e.grid}` : FACTION[view.side]);
  else if (e.type === 'captured' || e.type === 'lost') showToast(e.text, e.grid ? `Grid ${e.grid}` : 'Capture Point');
  else if (e.type === 'wiped') {
    const at = view.squads.find((q) => q.id === e.squad)?.redeployAt;
    showToast(e.text, `Redeploying at ${at ? `Capture Point ${view.points.find((p) => p.id === at)?.name ?? at}` : 'HQ'}`);
  } else if (e.type === 'request') {
    const who = e.squad !== null ? (view.squads.find((q) => q.id === e.squad)?.name ?? 'Squad') : 'Squad';
    showToast('Support requested', `${who}${e.grid ? ` · grid ${e.grid}` : ''} · tap to arm`);
  }
}

/** Updates the score strip for `view`, or hides it and the rail between matches. */
export function drawRail(view: CommanderView | null) {
  rail.hidden = score.hidden = !view;
  if (!view) {
    toastEl.hidden = true;
    toastEl.classList.remove('show');
    awards.replaceChildren();
    return;
  }
  const { commanderSide: us, enemySide: them } = session;
  const max = view.ticketsStart ?? DEFAULT_TUNE.tickets; // #152: Tickets scale with the Squad count
  const draining = drainingSide(view);
  const side = (s: SideId, cls: string) => {
    const pct = Math.max(0, Math.min(100, (100 * view.tickets[s]) / max)).toFixed(1);
    return `<div class="side ${cls}${draining === s ? ' draining' : ''}"><small>${FACTION[s]}</small><b>${view.tickets[s]}</b><div class="tbar"><i style="width:${pct}%"></i></div></div>`;
  };
  const badges = view.points.map((p) => pointBadge(p, us)).join('');
  const html = `${side(us, 'fr')}<div class="pts">${badges}</div><div class="clock">${clock(view.seconds)}</div>${side(them, 'ho')}`;
  if (score.dataset.h !== html) score.innerHTML = score.dataset.h = html;
}
