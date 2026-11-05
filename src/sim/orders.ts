// Orders (#36): each Squad has at most one standing Order, a Capture Point to take or hold. A Command is acknowledged after a
// seeded radio lag and the Squad acts on it from then on (`think` makes the ordered point its choice, see ai/squad.ts).
// Survival (Retreat, Resupply) delays an Order, never drops it; only a new Command replaces or clears it.
import type { Match } from './index';
import { rnd } from './rng';
import { membersOf, type Mix, type Squad } from './state';
import type { Command, SimEvent, SquadView } from './types';

/** A Squad's standing Order. */
export interface Order {
  point: number; // index of the Capture Point
  hold: boolean; // hold it: set when the point is the Side's own, or once taken; kept until the Commander changes it
  delayed: 'retreat' | 'resupply' | null; // survival has the Squad for now
}

/** An Order sent and not yet acknowledged; `point` -1 = clear. The standing Order stands until `due`. */
export interface Pending {
  point: number;
  due: number; // tick
}

const PHONETIC: Record<string, string> = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel' };
export const callName = (name: string) => PHONETIC[name] ?? name;

// radio.ts sets the priority of every line by its type, so the 0 here is never heard.
const say = (sq: Squad, type: string, text: string, events: SimEvent[]) => events.push({ kind: 'radio', side: sq.side, squad: sq.id, type, text, priority: 0 });

/** Takes an Order Command (already checked): replaces any pending one, so only the latest is acknowledged. */
export function giveOrder(m: Match, c: Extract<Command, { kind: 'order' }>) {
  const t = m.tune;
  const lag = Math.round((t.orderAckMinSeconds + rnd(m) * (t.orderAckMaxSeconds - t.orderAckMinSeconds)) * t.hz);
  m.squads[c.squad]!.pending = { point: c.point === null ? -1 : m.points.findIndex((p) => p.id === c.point), due: m.tick + lag };
}

const survival = (sq: Squad) => (sq.task === 'retreat' || sq.task === 'resupply' ? sq.task : null);
const delayText = (why: 'retreat' | 'resupply') => `negative, ${why === 'retreat' ? 'falling back' : 'resupplying'}, will move when clear`;

/** The Order phase: acknowledge what is due, turn a taken point into hold, and radio when survival delays or releases an Order. */
export function orders(m: Match, events: SimEvent[]) {
  for (const sq of m.squads) {
    if (sq.pending && m.tick >= sq.pending.due) {
      const { point } = sq.pending;
      sq.pending = null;
      const o: Order | null = point < 0 ? null : { point, hold: m.points[point]!.owner === sq.side, delayed: survival(sq) };
      sq.order = o;
      if (membersOf(m, sq).every((s) => s.state === 'dead')) continue; // a wiped Squad can't answer
      if (!o) say(sq, 'ack', 'copy, free to engage', events);
      else if (o.delayed) say(sq, 'delayed', delayText(o.delayed), events);
      else say(sq, 'ack', `copy, ${o.hold ? 'holding' : 'moving to'} ${callName(m.points[point]!.name)}`, events);
    }
    const o = sq.order;
    if (!o) continue;
    if (m.points[o.point]!.owner === sq.side) o.hold = true;
    if (sq.task === 'none') continue; // wiped: no change until it is back
    const now = survival(sq);
    if (now === o.delayed) continue;
    o.delayed = now;
    if (now) say(sq, 'delayed', delayText(now), events);
    else say(sq, 'resuming', `moving to ${callName(m.points[o.point]!.name)} now`, events);
  }
}

export function orderView(m: Match, sq: Squad): SquadView['order'] {
  const id = (i: number) => (i < 0 ? null : m.points[i]!.id);
  if (sq.pending) return { point: id(sq.pending.point), state: 'pending' };
  const o = sq.order;
  if (!o) return null;
  return o.delayed ? { point: id(o.point), state: 'delayed', reason: o.delayed } : { point: id(o.point), state: o.hold ? 'holding' : 'following' };
}

export function hashOrders(m: Match, mix: Mix) {
  for (const sq of m.squads) {
    const o = sq.order;
    mix(o ? o.point + 1 : 0);
    mix(o ? +o.hold : 0);
    mix(o?.delayed ? (o.delayed === 'retreat' ? 1 : 2) : 0);
    mix(sq.pending ? sq.pending.point + 2 : 0);
    mix(sq.pending?.due ?? 0);
  }
}
