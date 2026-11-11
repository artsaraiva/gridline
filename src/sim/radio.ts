// Radio (#38): Callouts (what a Squad says on its own) and spam control (what actually goes out, and when).
// Every other phase just says its line as a `radio` SimEvent; the radio phase runs last in the tick, adds the Callouts it
// finds in the tick's Events and the Squads' own state, and lets each Squad's net through: one line at a time, every
// `radioGapSeconds`, the higher priority first. Nothing here draws a random number, so replays stay the same.
import type { Match } from './index';
import { insideCount } from './capture';
import { dist2 } from './geometry';
import { gridRef } from './grid-ref';
import { callName, elite, membersOf, squadName, wiped, type Mix, type Squad } from './state';
import { enemyOf, type SideId, type SimEvent, type Vec2 } from './types';

/** Who gets the net first: Squad wiped = Man down, then Copy / Delayed acks, Contact, Taking fire, the rest (1). */
export const RADIO_PRIORITY: Record<string, number> = {
  wiped: 5,
  mandown: 5,
  ack: 4,
  delayed: 4,
  resuming: 4,
  contact: 3,
  fire: 2,
  capturing: 1,
  captured: 1,
  lost: 1,
  redeploying: 1,
  flanking: 1,
  request: 1, // the open Request on the tile and card is the loud part; the line is just "the rest"
};

// An Order's acks answer the Commander, so the same type twice in a row is still news.
const ANSWERS = new Set(['ack', 'delayed', 'resuming']);

type Line = Extract<SimEvent, { kind: 'radio' }>;

export interface Radio {
  next: number[]; // per Squad: first tick it may speak again
  slot: (Line | null)[]; // per Squad: the line waiting for that tick
  said: Record<string, number>[]; // per Squad: tick each type of line last went out
  sight: number[]; // per Squad: tick it last saw an enemy
  wiped: boolean[]; // per Squad: its wipe has been called
  taking: number[]; // per Squad: index of the point it is capturing, -1 = none
  owners: (SideId | null)[]; // per point: owner at the last tick
  down: boolean[]; // per Soldier: its Man down has been called
}

export const newRadio = (squads: number, soldiers: number, owners: (SideId | null)[]): Radio => ({
  next: Array(squads).fill(0),
  slot: Array(squads).fill(null),
  said: Array.from({ length: squads }, () => ({})),
  sight: Array(squads).fill(-1e9),
  wiped: Array(squads).fill(false),
  taking: Array(squads).fill(-1),
  owners: [...owners],
  down: Array(soldiers).fill(false),
});

export const priorityOf = (type: string) => RADIO_PRIORITY[type] ?? 1;

/** The radio phase. Runs after every phase that can say something, before the tick moves on. Rewrites `events`' radio lines. */
export function radio(m: Match, events: SimEvent[]) {
  const r = m.radio;
  const t = m.tune;
  const asked: Line[][] = m.squads.map(() => []); // everything each Squad wants to say this tick
  const out: SimEvent[] = [];
  const onNet = m.squads.map((sq) => elite(m, sq)); // #153: a Squad that is not Elite says nothing
  const say = (sq: Squad, type: string, text: string, at?: Vec2) => {
    if (onNet[sq.id]) asked[sq.id]!.push({ kind: 'radio', side: sq.side, squad: sq.id, type, text, ...(at && m.map.grid && { grid: gridRef(m.map.grid, at) }), priority: priorityOf(type) });
  };
  const squadOf = (soldier: number) => m.squads[m.soldiers[soldier]!.squad]!;
  const inside = (sq: Squad, p: Vec2 & { radius: number }) => membersOf(m, sq).some((s) => s.state === 'alive' && dist2(s, p) < p.radius * p.radius);

  for (const e of events) {
    if (e.kind === 'wounded') {
      r.down[e.id] = true;
      say(squadOf(e.id), 'mandown', 'man down', e);
    } else if (e.kind === 'death') {
      if (!r.down[e.id]) say(squadOf(e.id), 'mandown', 'man down', e); // killed outright
      r.down[e.id] = false;
    } else if (e.kind === 'revived') r.down[e.id] = false;
    else if (e.kind === 'shot' && m.soldiers[e.to]) say(squadOf(e.to), 'fire', 'taking fire', m.soldiers[e.to]); // #107: a vehicle shot at says nothing
    else if (e.kind === 'suppressive') {
      for (const sq of m.squads) {
        const near = sq.side !== e.side && membersOf(m, sq).find((s) => s.state === 'alive' && dist2(s, e) <= t.suppressiveRadiusM * t.suppressiveRadiusM);
        if (near) say(sq, 'fire', 'suppressed', near);
      }
    } else if (e.kind === 'redeploy') say(m.squads[e.squad]!, 'redeploying', 'redeploying', e);
  }

  // The lines other phases sent (acks, flanking, ...) join the Squad's own; the Asset net and Commander-side lines go straight out.
  for (const e of events) {
    if (e.kind !== 'radio') out.push(e);
    else if (e.squad === null || e.type === 'wiped') out.push({ ...e, priority: priorityOf(e.type) });
    else if (onNet[e.squad]) asked[e.squad]!.push({ ...e, priority: priorityOf(e.type) });
  }

  m.points.forEach((p, i) => {
    const was = r.owners[i];
    r.owners[i] = p.owner;
    if (p.owner === was) return;
    // #85: a loss is the losing Side's net's to report, once and not held back by spam control: the Squad that held the
    // point may be gone, elsewhere, or have something louder waiting, and the Commander must hear it either way
    if (was) out.push({ kind: 'radio', side: was, squad: null, type: 'lost', text: `${callName(p.name)} lost`, ...(m.map.grid && { grid: gridRef(m.map.grid, p) }), priority: RADIO_PRIORITY.lost! });
    const takers = m.squads.filter((sq) => p.owner === sq.side && inside(sq, p) && !wiped(membersOf(m, sq)));
    for (const sq of takers) say(sq, 'captured', `${callName(p.name)} captured`, p);
    // #153: Squads that are not Elite don't talk, so the Side net reports their capture once, as it reports a loss. Only when
    // one of them took it: a flip with no Squad inside stays silent as before, so a Match of Elite Squads only is unchanged
    if (takers.length && !takers.some((sq) => onNet[sq.id])) out.push({ kind: 'radio', side: p.owner!, squad: null, type: 'captured', text: `${callName(p.name)} captured`, ...(m.map.grid && { grid: gridRef(m.map.grid, p) }), priority: RADIO_PRIORITY.captured! });
  });

  for (const sq of m.squads) {
    if (!onNet[sq.id]) continue;
    const members = membersOf(m, sq);
    const i = sq.id;
    if (wiped(members)) {
      if (!r.wiped[i]) {
        const last = members.reduce((a, s) => (s.deadAt >= a.deadAt ? s : a));
        out.push({ kind: 'radio', side: sq.side, squad: i, type: 'wiped', text: `${squadName(m, sq)} wiped`, ...(m.map.grid && { grid: gridRef(m.map.grid, last) }), priority: RADIO_PRIORITY.wiped! });
        r.wiped[i] = true;
      }
      r.slot[i] = null;
      r.taking[i] = -1;
      continue;
    }
    r.wiped[i] = false;

    // Contact: only what its own Soldiers saw this tick, and only after a quiet stretch.
    const seen = sq.memory.filter((s) => s.source === 'seen' && s.tick === m.tick);
    if (seen.length) {
      if (m.tick - r.sight[i]! >= t.radioQuietSeconds * t.hz) {
        const me = members.find((s) => s.state !== 'dead')!;
        const nearest = seen.reduce((a, s) => (dist2(s, me) < dist2(a, me) ? s : a));
        say(sq, 'contact', `contact, ${seen.length > 1 ? `${seen.length} ` : ''}infantry`, nearest);
      }
      r.sight[i] = m.tick;
    }

    // Capturing: on the first tick it holds the larger share of a point that is not its Side's.
    const k = m.points.findIndex((p) => p.owner !== sq.side && inside(sq, p) && insideCount(m, p, sq.side) > insideCount(m, p, enemyOf(sq.side)));
    if (k >= 0 && k !== r.taking[i]) say(sq, 'capturing', `capturing ${callName(m.points[k]!.name)}`, m.points[k]);
    r.taking[i] = k;

    // Spam control: the highest priority waits in the slot; the gap decides when it goes out.
    for (const line of asked[i]!) {
      if (!ANSWERS.has(line.type) && m.tick - (r.said[i]![line.type] ?? -1e9) < t.radioRepeatSeconds * t.hz) continue;
      const waiting = r.slot[i];
      if (!waiting || line.priority > waiting.priority) r.slot[i] = line;
    }
    const line = r.slot[i];
    if (line && m.tick >= r.next[i]!) {
      out.push(line);
      r.slot[i] = null;
      r.next[i] = m.tick + Math.round(t.radioGapSeconds * t.hz);
      r.said[i]![line.type] = m.tick;
    }
  }
  events.length = 0;
  events.push(...out);
}

export function hashRadio(m: Match, mix: Mix) {
  const r = m.radio;
  const word = (s: string) => {
    mix(s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  for (const sq of m.squads) {
    const i = sq.id;
    mix(r.next[i]!);
    mix(r.sight[i]!);
    mix(+r.wiped[i]!);
    mix(r.taking[i]!);
    const slot = r.slot[i];
    word(slot ? slot.type : '');
    for (const type of Object.keys(r.said[i]!)) {
      word(type);
      mix(r.said[i]![type]!);
    }
  }
  for (const o of r.owners) mix(o === null ? 0 : o === 'nato' ? 1 : 2);
  for (const d of r.down) mix(+d);
}
