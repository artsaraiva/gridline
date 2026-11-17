// The score strip top-centre (Capture Point badges with capture arcs between the two Sides' Tickets and bars, the clock
// under them, a mark on the Side that is draining), the score feed low on the map's centre (#72), and right-side
// toasts on major radio events. `chrome/assets.ts` owns the Asset keypad itself.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView, PointView, SideId, SimEvent } from '../../sim/types';
import { PAD_SIZE } from '../pad';
import { session } from '../session';
import { addAward, type FeedAward, feedLook } from '../score-feed';
import { clock, drainingSide, FACTION } from '../summary';
import { POINT_FRAME } from './icons';

/** Chrome geometry in px, which frames the map (`fitView`) and places its grid labels. `console.css` sizes the same boxes:
 * `margin` is every panel's inset, `pad` the Asset keypad in the top-left corner (#181), `column` the strip the frame keeps
 * clear on the left under it (the one-column rail's, so the frame stays as it was), `squadRail` the `.tile`, `top` clears the
 * score strip and the grid letters under it, `bottom` the cursor readout, `gridLabels` the numbers left of the map. */
export const LAYOUT = { margin: 16, pad: PAD_SIZE, column: 40, squadRail: 56, gap: 16, gridLabels: 26, top: 92, bottom: 44 };

const rail = document.getElementById('rail')!;
const score = document.getElementById('score')!;
const feed = document.body.appendChild(document.createElement('div'));
feed.id = 'feed';
feed.hidden = true;
feed.innerHTML = '<div class="tot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 22 15H15.5V21H8.5V15H2Z"/></svg><span></span></div><i class="rule"></i><div class="why"></div>';
const feedTotal = feed.querySelector('span')!;
const feedWhy = feed.querySelector<HTMLElement>('.why')!;
/** The awards of the score feed's open total, oldest first. */
const awarded: FeedAward[] = [];
const toastEl = document.getElementById('toast')!;
const toastTitle = toastEl.querySelector('div')!;
const toastSub = toastEl.querySelector('small')!;

function pointBadge(p: PointView, us: SideId): string {
  const own = p.owner === null ? 'ne' : p.owner === us ? 'fr' : 'ho';
  const col = own === 'fr' ? 'var(--fr)' : own === 'ho' ? 'var(--ho)' : 'var(--bone)';
  const shape = POINT_FRAME[own];
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

/** #72: adds an own-Side award to the score feed. */
export function showAward(e: SimEvent, view: CommanderView, now: number) {
  if (e.kind === 'award' && e.side === view.side) addAward(awarded, { at: now, points: e.points, reason: e.reason });
}

/** Draws the score feed at `now` ms: the running total over its reasons, or nothing once it has lifted away. */
export function drawScoreFeed(now: number) {
  const look = feedLook(awarded, now);
  feed.hidden = !look;
  if (!look) return;
  feed.style.opacity = String(look.opacity);
  feed.style.transform = `translateY(${-look.lift}px)`;
  feedTotal.textContent = String(look.total);
  feedTotal.parentElement!.style.transform = `scale(${look.scale})`;
  const html = look.lines.map((l) => `<div><span>${l.reason}</span>${l.times > 1 ? `<i>×${l.times}</i>` : ''}<b>${l.points}</b></div>`).join('');
  if (feedWhy.dataset.h !== html) feedWhy.innerHTML = feedWhy.dataset.h = html;
}

/** Fires a toast on notable own-Side radio events (Asset called, point captured/lost, Squad wiped, Request). */
export function toastEvent(e: SimEvent, view: CommanderView) {
  if (e.side !== view.side || e.kind !== 'radio') return;
  if (e.type === 'asset') showToast(e.text, e.grid ? `Grid ${e.grid}` : FACTION[view.side]);
  else if (e.type === 'captured' || e.type === 'lost') showToast(e.text, e.grid ? `Grid ${e.grid}` : 'Capture Point');
  else if (e.type === 'wiped') {
    const q = view.squads.find((q) => q.id === e.squad);
    const at = q?.redeployAt;
    showToast(e.text, `Redeploying at ${q?.atBeacon ? 'the Redeploy Beacon' : at ? `Capture Point ${view.points.find((p) => p.id === at)?.name ?? at}` : 'HQ'}`); // #142
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
    awarded.length = 0;
    feed.hidden = true;
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
