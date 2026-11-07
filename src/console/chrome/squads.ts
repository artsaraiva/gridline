// Right rail (#36, #41, #44): one 56 × 48 tile per Squad (letter, 4 health pips, amber border when Delayed, blinking
// amber corner when a Request is open, dimmed when wiped); the selected Squad opens in place into a 248 px card (letter,
// name, pips, Order and state, grid, open Request with timer, Clear order).
import { gridRef } from '../../sim/grid-ref';
import type { CommanderView, SquadView } from '../../sim/types';
import { session } from '../session';
import { clock, orderLine, requestLine, squadAlert, squadCentroid } from '../summary';
import { answer, clearOrder, select, targeting } from '../targeting';
import { assetIcon, TANK_BADGE } from './icons';

const box = document.getElementById('squads')!;
const tilesBox = box.querySelector<HTMLElement>('.tiles')!;
const card = box.querySelector<HTMLElement>('.card')!;
card.dataset.hit = '';
card.onclick = (e) => {
  if (!(e.target as HTMLElement).closest('button')) select(null);
};
let tiles: HTMLButtonElement[] = [];

export function resetSquads() {
  tiles = [];
  tilesBox.replaceChildren();
}

const wiped = (q: SquadView) => q.redeployIn !== null;

function pips(q: SquadView, view: CommanderView): string {
  const wounded = view.friendlies.filter((f) => f.squad === q.id && f.state === 'wounded').length;
  return Array.from({ length: q.size }, (_, n) =>
    n < q.strength ? '<i class="on ok"></i>' : n < q.strength + wounded ? '<i class="hurt"></i>' : '<i></i>',
  ).join('');
}

/** #107: a tank badge per member aboard one; vehicles themselves are never listed. */
function badges(q: SquadView, view: CommanderView): string {
  const aboard = view.friendlies.filter((f) => f.squad === q.id && f.vehicle !== undefined).length;
  return aboard ? `<span class="veh">${TANK_BADGE.repeat(aboard)}</span>` : '';
}

const alertOf = (q: SquadView, view: CommanderView) => squadAlert(q, view.friendlies.some((f) => f.squad === q.id && f.suppressed));

function whereOf(q: SquadView, view: CommanderView): string {
  if (wiped(q)) return 'HQ';
  const c = squadCentroid(view, q.id);
  const g = session.host?.map.grid;
  return c && g ? gridRef(g, c) : 'HQ';
}

function stateOf(q: SquadView): string {
  if (wiped(q)) return `REDEPLOY ${clock(Math.ceil(q.redeployIn!))}`;
  if (q.order) return q.order.state.toUpperCase();
  return (q.task ?? 'Free to engage').toUpperCase();
}

/** The rail for `view`, or hidden between matches. */
export function drawSquads(view: CommanderView | null) {
  box.hidden = !view;
  if (!view) return;
  if (tiles.length !== view.squads.length) {
    tilesBox.replaceChildren();
    tiles = view.squads.map((q, i) => {
      const t = tilesBox.appendChild(document.createElement('button'));
      t.type = 'button';
      t.dataset.hit = '';
      t.style.order = String(i);
      t.onclick = () => select(targeting.selected === q.id ? null : q.id); // a tile only selects; the card button and the radio line answer a Request
      return t;
    });
  }
  let selIdx = -1;
  view.squads.forEach((q, i) => {
    const t = tiles[i]!;
    const isSel = targeting.selected === q.id;
    if (isSel) selIdx = i;
    t.hidden = isSel;
    const cls = `tile${isSel ? ' sel' : ''}${q.order?.state === 'delayed' ? ' delayed' : ''}${wiped(q) ? ' wiped' : ''}${q.request ? ' req' : ''}${alertOf(q, view) ? ' fire' : ''}`;
    const html = `${q.request ? `<span class="rq">${assetIcon(q.request.asset, 2.4)}</span>` : ''}<b>${q.name[0]}</b><span class="pips">${pips(q, view)}</span>${badges(q, view)}`;
    if (t.className !== cls) t.className = cls;
    if (t.dataset.h !== html) t.innerHTML = t.dataset.h = html;
    t.title = q.name;
  });
  const q = selIdx >= 0 ? view.squads[selIdx] : undefined;
  card.hidden = !q;
  if (!q) return;
  card.style.order = String(selIdx);
  const cardCls = `squad card sel${wiped(q) ? ' wiped' : ''}`;
  if (card.className !== cardCls) card.className = cardCls;
  const delayed = q.order?.state === 'delayed';
  const html =
    `<div class="letter">${q.name[0]}</div>` +
    `<div class="body">` +
    `<div class="top"><b>${q.name}</b>${alertOf(q, view) ? `<span class="alert">${alertOf(q, view)}</span>` : ''}<span class="pips">${pips(q, view)}${badges(q, view)}</span></div>` +
    `<div class="ord${delayed ? ' delayed' : ''}"><span>${orderLine(q, view)}</span><span class="st${delayed ? ' delayed' : ''}">${stateOf(q)}</span><span class="where">${whereOf(q, view)}</span></div>` +
    (q.request ? `<button type="button" class="ask">${assetIcon(q.request.asset, 2)}<span>${requestLine(q.request)}</span></button>` : '') +
    (q.order ? '<button type="button" class="clr">Clear order</button>' : '') +
    `</div>`;
  if (card.dataset.h === html) return;
  card.innerHTML = card.dataset.h = html;
  const clr = card.querySelector<HTMLButtonElement>('.clr');
  if (clr)
    clr.onclick = (e) => {
      e.stopPropagation();
      clearOrder();
    };
  const ask = card.querySelector<HTMLButtonElement>('.ask');
  if (ask)
    ask.onclick = (e) => {
      e.stopPropagation();
      answer(q.id);
    };
}
