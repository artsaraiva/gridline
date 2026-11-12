// Left rail Faction header and score block (point badges with capture arcs, Tickets with bars, clock, drain line, Commander
// Score), the contribution messages under it (#72), plus right-side toasts on major radio events. #37's `chrome/assets.ts`
// owns the Asset rows between them.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView, PointView, SideId, SimEvent } from '../../sim/types';
import { session } from '../session';
import { awardLine, clock, drainLine, FACTION } from '../summary';

/** Variant A ("Rails") geometry in px: 16 px margin, 248 px left rail, 56 px right Squad tile column, 16 px inner gap. */
export const RAILS = { margin: 16, left: 248, right: 56, gap: 16, vMargin: 32 };

const rail = document.getElementById('rail')!;
const factionCell = document.getElementById('faction-cell')!;
const factionSub = document.getElementById('faction-sub')!;
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

/** #72: shows an award as a contribution message under the score block for a few seconds. */
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

/** Updates the left rail Faction cell and score block for `view`, or hides the rail between matches. */
export function drawRail(view: CommanderView | null) {
  rail.hidden = !view;
  if (!view) {
    toastEl.hidden = true;
    toastEl.classList.remove('show');
    awards.replaceChildren();
    return;
  }
  const { commanderSide: us, enemySide: them } = session;
  const cell = us === 'nato' ? 'NATO' : 'PACT';
  const sub = `${FACTION[us]} · ${session.host?.map.name ?? 'Kaltenbach'}`;
  if (factionCell.textContent !== cell) factionCell.textContent = cell;
  if (factionSub.textContent !== sub) factionSub.textContent = sub;

  const max = view.ticketsStart ?? DEFAULT_TUNE.tickets; // #152: Tickets scale with the Squad count
  const usPct = Math.max(0, Math.min(100, (100 * view.tickets[us]) / max));
  const themPct = Math.max(0, Math.min(100, (100 * view.tickets[them]) / max));
  const html =
    `<div class="pts">${view.points.map((p) => pointBadge(p, us)).join('')}</div>` +
    `<div class="row">` +
    `<div class="side fr"><small>${FACTION[us]}</small><b>${view.tickets[us]}</b><div class="tbar"><i style="width:${usPct.toFixed(1)}%"></i></div></div>` +
    `<div class="clock">${clock(view.seconds)}</div>` +
    `<div class="side ho"><small>${FACTION[them]}</small><b>${view.tickets[them]}</b><div class="tbar"><i style="width:${themPct.toFixed(1)}%"></i></div></div>` +
    `</div>` +
    `<div class="drain">${drainLine(view)}</div>` +
    `<div class="cscore"><small>Commander Score</small><b>${Math.round(view.score?.total ?? 0)}</b></div>`;
  if (score.dataset.h !== html) score.innerHTML = score.dataset.h = html;
}
