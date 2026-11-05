// The plain right rail (#36): one tile per Squad (letter, health pips, amber border when Delayed, dimmed when wiped) and
// the selected Squad's card with its Order line and Clear; #41 adds the open Request (blinking amber tile corner, card button
// with its countdown, tap to arm the Asset). #44 owns the rail's look; this is the behaviour.
import type { CommanderView, SquadView } from '../../sim/types';
import { orderLine, requestLine } from '../summary';
import { answer, clearOrder, select, targeting } from '../targeting';

const box = document.getElementById('squads')!;
const tilesBox = box.querySelector<HTMLElement>('.tiles')!;
const card = box.querySelector<HTMLElement>('.card')!;
let tiles: HTMLButtonElement[] = [];

export function resetSquads() {
  tiles = [];
  tilesBox.replaceChildren();
}

const wiped = (q: SquadView) => q.redeployIn !== null;

/** The rail for `view`, or hidden between matches. */
export function drawSquads(view: CommanderView | null) {
  box.hidden = !view;
  if (!view) return;
  if (tiles.length !== view.squads.length) {
    tilesBox.replaceChildren();
    tiles = view.squads.map((q) => {
      const t = tilesBox.appendChild(document.createElement('button'));
      t.onclick = () => (targeting.selected === q.id ? select(null) : answer(q.id)); // answer selects, and arms when a Request is open
      return t;
    });
  }
  view.squads.forEach((q, i) => {
    const t = tiles[i]!;
    const cls = `tile${targeting.selected === q.id ? ' sel' : ''}${q.order?.state === 'delayed' ? ' delayed' : ''}${wiped(q) ? ' wiped' : ''}${q.request ? ' req' : ''}`;
    const html = `<b>${q.name[0]}</b><span class="pips">${Array.from({ length: q.size }, (_, n) => `<i${n < q.strength ? ' class="on"' : ''}></i>`).join('')}</span>`;
    if (t.className !== cls) t.className = cls;
    if (t.dataset.h !== html) t.innerHTML = t.dataset.h = html;
    t.title = q.name;
  });
  const q = view.squads.find((q) => q.id === targeting.selected);
  card.hidden = !q;
  if (!q) return;
  const html = `<h3>${q.name.toUpperCase()} <small>${wiped(q) ? `REDEPLOY ${Math.ceil(q.redeployIn!)}` : `${q.strength}/${q.size}${q.task ? ` · ${q.task.toUpperCase()}` : ''}`}</small></h3>` +
    `<div class="ord${q.order?.state === 'delayed' ? ' delayed' : ''}">${orderLine(q, view)}</div>` +
    (q.request ? `<button class="ask">${requestLine(q.request)}</button>` : '') +
    (q.order ? '<button class="clr">Clear order</button>' : '<small>Tap a Capture Point to order</small>');
  if (card.dataset.h === html) return;
  card.innerHTML = card.dataset.h = html;
  const clr = card.querySelector<HTMLButtonElement>('.clr');
  if (clr) clr.onclick = clearOrder;
  const ask = card.querySelector<HTMLButtonElement>('.ask');
  if (ask) ask.onclick = () => answer(q.id);
}
