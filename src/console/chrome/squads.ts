// Right rail (#36, #41, #44): one 56 × 48 tile per Squad (letter, 4 health pips, amber border when Delayed, blinking
// amber corner when a Request is open, dimmed when wiped); the selected Squad opens in place into a 264 × 90 px card whose
// height never changes: name and pips, then alert, state and grid, then the Request and the Order as two buttons side by
// side, each disabled while there is nothing to answer or clear.
import { gridRef } from '../../sim/grid-ref';
import type { CommanderView, SquadView } from '../../sim/types';
import { session } from '../session';
import { clock, orderLine, orderState, requestLine, squadAlert, squadCentroid } from '../summary';
import { answer, clearOrder, select, targeting } from '../targeting';
import { assetIcon, VEHICLE_BADGE } from './icons';

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

/** #107: a badge per member aboard a vehicle, of its class (#108: tank or jeep, #109 helicopter); vehicles themselves are never listed. */
function badges(q: SquadView, view: CommanderView): string {
  const kinds = view.friendlies.filter((f) => f.squad === q.id && f.vehicle !== undefined).map((f) => view.vehicles?.find((v) => v.id === f.vehicle)?.kind);
  return kinds.length ? `<span class="veh">${kinds.map((k) => VEHICLE_BADGE[k ?? 'tank']).join('')}</span>` : '';
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
  if (q.order) return orderState(q.order);
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
  const alert = alertOf(q, view);
  const order = orderLine(q, view);
  const html =
    `<div class="letter">${q.name[0]}</div>` +
    `<div class="body">` +
    `<div class="top"><b>${q.name}</b><span class="pips">${pips(q, view)}${badges(q, view)}</span></div>` +
    `<div class="st">${alert ? `<span class="alert">${alert}</span>` : ''}<span${delayed ? ' class="delayed"' : ''}>${stateOf(q)}</span><span class="where">${whereOf(q, view)}</span></div>` +
    `<div class="acts">` +
    (q.request
      ? `<button type="button" class="ask" title="${requestLine(q.request)}">${assetIcon(q.request.asset, 2)}<span>${q.request.grid ?? ''} ${clock(Math.ceil(q.request.left))}</span></button>`
      : '<button type="button" class="ask" disabled>No request</button>') +
    (order ? `<button type="button" class="clr" title="Clear order ${order}"><span>${order}</span><i>✕</i></button>` : '<button type="button" class="clr" disabled>No order</button>') +
    `</div></div>`;
  if (card.dataset.h === html) return;
  card.innerHTML = card.dataset.h = html;
  card.querySelector<HTMLButtonElement>('.clr')!.onclick = (e) => {
    e.stopPropagation();
    clearOrder();
  };
  card.querySelector<HTMLButtonElement>('.ask')!.onclick = (e) => {
    e.stopPropagation();
    answer(q.id);
  };
}
