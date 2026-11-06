// The radio log (#38): the Commander's Side's radio lines, typed out one at a time as they go on air, newest at the bottom,
// older lines fading, the Grid Reference as a bone chip, bad news in red. ▾ folds it to the newest line. Tapping a line
// pans the map to its grid and selects the Squad. While a line types, the "Squad net" light is on and the radio sounds.
import { gridCentre } from '../../sim/grid-ref';
import type { CommanderView, SimEvent } from '../../sim/types';
import { transmit } from '../audio';
import { burst } from '../post';
import { camera } from '../renderer';
import { session } from '../session';
import { radioLine } from '../summary';
import { answer, select } from '../targeting';

const KEPT = 8; // lines in the log
const CPS = 45; // characters typed per second; faster when lines are queued up
const PAN_MS = 250;

type Line = NonNullable<ReturnType<typeof radioLine>>;

const box = document.getElementById('radio')!;
const list = box.querySelector<HTMLElement>('.lines')!;
const light = document.getElementById('net')!;
const fold = document.getElementById('radio-fold')!;
let queue: Line[] = [];
let typing: { text: HTMLElement; chip: HTMLElement | null; full: string; start: number; cps: number; onAir: boolean } | null = null;
let offAir = 0; // when the net light goes out

fold.onclick = () => {
  box.classList.toggle('folded');
  fold.setAttribute('aria-expanded', String(!box.classList.contains('folded')));
};

export function resetRadioLog() {
  queue = [];
  typing = null;
  offAir = 0;
  list.replaceChildren();
  light.classList.remove('on');
}

/** Queues the log line for `e`, if it has one. */
export function logRadio(e: SimEvent, view: CommanderView) {
  const line = radioLine(e, view);
  if (line) queue.push(line);
}

let panning = 0;
/** Eases the map camera to `to` (metres). */
function panTo(to: { x: number; y: number }) {
  const from = { x: camera.position.x, y: camera.position.y };
  const t0 = performance.now();
  const id = ++panning;
  burst(0.5);
  const frame = (now: number) => {
    if (id !== panning) return; // a drag or another tap took over
    const k = Math.min(1, (now - t0) / PAN_MS);
    const e = 1 - (1 - k) ** 3;
    camera.position.x = from.x + (to.x - from.x) * e;
    camera.position.y = from.y + (to.y - from.y) * e;
    if (k < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
addEventListener('pointerdown', () => panning++, { capture: true });

function open(line: Line, now: number) {
  const row = list.appendChild(document.createElement('div'));
  row.className = `ln${line.bad ? ' bad' : ''}${line.request ? ' req' : ''}`;
  row.innerHTML = '<b></b><span class="tx"></span><i class="chip"></i>';
  row.querySelector('b')!.textContent = `${line.from}:`;
  const chip = row.querySelector<HTMLElement>('.chip')!;
  const centre = line.grid && session.host?.map.grid ? gridCentre(session.host.map.grid, line.grid) : null;
  if (line.grid) chip.textContent = line.grid;
  else chip.remove();
  if (line.squad !== null || centre) {
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.onclick = () => {
      if (line.squad !== null) (line.request ? answer : select)(line.squad); // a Request arms its Asset at the grid
      if (centre) panTo(centre);
    };
    row.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && row.click();
  }
  while (list.childElementCount > KEPT) list.firstElementChild!.remove();
  const full = line.text;
  let seconds = full.length / (CPS * (1 + queue.length));
  if (line.onAir) seconds = transmit(seconds, full); // a Voice Line is on air for its sample's length, and the line types for as long
  typing = { text: row.querySelector<HTMLElement>('.tx')!, chip: line.grid ? chip : null, full, start: now, cps: full.length / seconds, onAir: line.onAir };
  chip.style.visibility = 'hidden'; // shown once the line is out, so nothing jumps while it types
}

/** Advances the typing; call once a frame. */
export function drawRadioLog(now: number) {
  if (!typing && queue.length) open(queue.shift()!, now);
  if (typing) {
    const n = Math.floor(((now - typing.start) / 1000) * typing.cps);
    typing.text.textContent = typing.full.slice(0, n);
    if (typing.onAir) offAir = now + 120;
    if (n >= typing.full.length) {
      typing.text.textContent = typing.full;
      if (typing.chip) typing.chip.style.visibility = '';
      typing = null;
    }
  }
  light.classList.toggle('on', now < offAir);
}

/** The log is shown while a match runs. */
export const showRadioLog = (on: boolean) => (box.hidden = !on);
