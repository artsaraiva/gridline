// DEV-only Commander look review timeline (#69): a hand-written, deterministic script of CommanderViews and Events on
// Kaltenbach coordinates, so the Console's readability treatments (#70 firing pulse, #71 selection and Squad Leader
// markers) are judged on every Squad Leader state without a Simulation. `viewAt` and `eventsBetween` are pure.
import type { CommanderView, FriendlyView, SimEvent, SoldierView, SquadView } from '../../sim/types';

export const LENGTH = 72;

/** Where each state starts, for scrubbing. */
export const CHAPTERS = [
  { at: 0, title: 'Overlap' },
  { at: 10, title: 'Firing' },
  { at: 20, title: 'Wounded leader' },
  { at: 30, title: 'Succession' },
  { at: 40, title: 'No leader' },
  { at: 50, title: 'Wipe' },
  { at: 62, title: 'Redeploy' },
];

/** Centre of the overlapping Squads, for the close zoom preset. */
export const CLOSE_AT = { x: -66, y: 18 };

const HQ = { x: -415, y: 0 };
const HZ = 20;

type Span = [number, number];
type Key = [t: number, x: number, y: number];
interface Man {
  id: number;
  squad: number;
  path: Key[];
  wounded?: Span[];
  dead?: Span[];
  fx: number;
  fy: number;
}

const inSpan = (spans: Span[] | undefined, t: number) => !!spans?.some(([a, b]) => t >= a && t < b);

/** Linear interpolation along `path`, held at the ends. */
function at(path: Key[], t: number): { x: number; y: number } {
  let prev = path[0]!;
  for (const key of path) {
    if (key[0] > t) {
      const k = (t - prev[0]) / (key[0] - prev[0]);
      return { x: prev[1] + (key[1] - prev[1]) * k, y: prev[2] + (key[2] - prev[2]) * k };
    }
    prev = key;
  }
  return { x: prev[1], y: prev[2] };
}

// Alpha (0..3) and Bravo (4..7) sit on the same ground west of the centre bridge, members interleaved along x.
// Charlie (8..11) holds south-west. Contacts (20..22) are 50 m east, facing them.
const east = { fx: 1, fy: 0 };
const MEN: Man[] = [
  { id: 0, squad: 0, path: [[0, -78, 22], [LENGTH, -74, 24]], wounded: [[20, 30]], dead: [[30, 40]], ...east },
  { id: 1, squad: 0, path: [[0, -66, 26], [LENGTH, -63, 27]], ...east },
  { id: 2, squad: 0, path: [[0, -58, 14], [LENGTH, -56, 16]], ...east },
  { id: 3, squad: 0, path: [[0, -70, 10], [LENGTH, -68, 12]], ...east },
  { id: 4, squad: 1, path: [[0, -72, 18], [50, -70, 19], [62, -400, 4], [LENGTH, -360, 8]], dead: [[50, 62]], ...east },
  { id: 5, squad: 1, path: [[0, -62, 20], [50, -60, 21], [62, -404, -4], [LENGTH, -366, 0]], dead: [[50, 62]], ...east },
  { id: 6, squad: 1, path: [[0, -54, 24], [50, -52, 25], [62, -410, 10], [LENGTH, -372, 14]], dead: [[50, 62]], ...east },
  { id: 7, squad: 1, path: [[0, -64, 8], [50, -62, 9], [62, -412, -8], [LENGTH, -374, -4]], dead: [[50, 62]], ...east },
  { id: 8, squad: 2, path: [[0, -150, -118]], wounded: [[40, 52]], fx: 0.7, fy: 0.7 },
  { id: 9, squad: 2, path: [[0, -142, -126]], wounded: [[40, 47]], fx: 0.7, fy: 0.7 },
  { id: 10, squad: 2, path: [[0, -158, -128]], wounded: [[40, 52]], fx: 0.7, fy: 0.7 },
  { id: 11, squad: 2, path: [[0, -146, -136]], wounded: [[40, 52]], fx: 0.7, fy: 0.7 },
];
const CONTACTS: Man[] = [
  { id: 20, squad: -1, path: [[0, -14, 30], [LENGTH, -18, 28]], fx: -1, fy: 0 },
  { id: 21, squad: -1, path: [[0, -10, 12], [LENGTH, -12, 10]], fx: -1, fy: 0 },
  { id: 22, squad: -1, path: [[0, -16, -4], [LENGTH, -20, -2]], fx: -1, fy: 0 },
];

interface Sq {
  id: number;
  name: string;
  members: number[];
  /** Squad Leader as a step function of time, following the Simulation's rule by hand (#68). */
  leader: [t: number, id: number | null][];
  wiped?: Span;
}
const SQUADS: Sq[] = [
  { id: 0, name: 'Alpha', members: [0, 1, 2, 3], leader: [[0, 0], [30, 1]] },
  { id: 1, name: 'Bravo', members: [4, 5, 6, 7], leader: [[0, 4], [50, null], [62, 4]], wiped: [50, 62] },
  { id: 2, name: 'Charlie', members: [8, 9, 10, 11], leader: [[0, 8], [40, null], [47, 9]] },
];

const POINTS = [
  { id: 'A', name: 'A', x: -262, y: -322, radius: 25, owner: 'nato' as const, progress: 1 },
  { id: 'B', name: 'B', x: 0, y: 300, radius: 25, owner: null, progress: 0 },
  { id: 'C', name: 'C', x: 0, y: 0, radius: 25, owner: null, progress: 0 },
  { id: 'D', name: 'D', x: 0, y: -300, radius: 25, owner: null, progress: 0 },
  { id: 'E', name: 'E', x: 262, y: 322, radius: 25, owner: 'pact' as const, progress: -1 },
];

const soldier = (m: Man, t: number): SoldierView => ({ id: m.id, ...at(m.path, t), fx: m.fx, fy: m.fy });

function squadView(q: Sq, t: number): SquadView {
  const men = MEN.filter((m) => q.members.includes(m.id));
  const gone = inSpan(q.wiped && [q.wiped], t);
  const deadUntil = (m: Man) => m.dead?.find(([a, b]) => t >= a && t < b)?.[1];
  const leader = [...q.leader].reverse().find(([a]) => t >= a)![1];
  return {
    id: q.id,
    name: q.name,
    size: men.length,
    strength: men.filter((m) => !inSpan(m.dead, t) && !inSpan(m.wounded, t)).length,
    respawnIn: gone ? [] : men.map(deadUntil).filter((b): b is number => b !== undefined).map((b) => b - t),
    takingFire: !gone && t >= CHAPTERS[1]!.at,
    ...(gone && { redeployAt: null }),
    redeployIn: gone ? q.wiped![1] - t : null,
    task: gone ? null : 'hold',
    point: gone ? null : 'C',
    route: null,
    order: null,
    request: null,
    leader,
  };
}

/** The Commander's view at `t` seconds into the timeline. */
export function viewAt(t: number): CommanderView {
  const friendlies: FriendlyView[] = MEN.filter((m) => !inSpan(m.dead, t)).map((m) => ({
    ...soldier(m, t),
    squad: m.squad,
    state: inSpan(m.wounded, t) ? 'wounded' : 'alive',
    suppressed: false,
    ammo: 0.8,
  }));
  return {
    side: 'nato',
    tick: Math.round(t * HZ),
    seconds: t,
    friendlies,
    contacts: CONTACTS.map((c) => soldier(c, t)),
    lastKnown: [],
    squads: SQUADS.map((q) => squadView(q, t)),
    points: POINTS,
    tickets: { nato: 150, pact: 150 },
    result: null,
    assets: [],
    effects: [],
  };
}

/** Events with `t0 < time <= t1`, in time order: what crossed since the last frame while playing. */
export function eventsBetween(t0: number, t1: number): SimEvent[] {
  return EVENTS.filter(([t]) => t > t0 && t <= t1).map(([, e]) => e);
}

/** Fit to fire at `t`: not down, and not going down within the next second (so the shooter is still drawn when the tracer lands). */
const fit = (m: Man, t: number) => !inSpan(m.dead, t) && !inSpan(m.wounded, t) && !inSpan(m.dead, t + 1) && !inSpan(m.wounded, t + 1);

/** The firefight: from the Firing chapter on, Alpha and Bravo trade fire with the Contacts, who also fire suppressive at the Squads' ground. */
function firefight(): [number, SimEvent][] {
  const events: [number, SimEvent][] = [];
  const squads = MEN.filter((m) => m.squad < 2);
  const start = CHAPTERS[1]!.at;
  let i = 0;
  for (let t = start; t < LENGTH; t += 0.6, i++) {
    const shooters = squads.filter((m) => fit(m, t));
    const from = shooters[i % shooters.length];
    if (from) events.push([t, { kind: 'shot', side: 'nato', from: from.id, to: CONTACTS[i % CONTACTS.length]!.id, hit: i % 3 === 0 }]);
  }
  i = 0;
  for (let t = start + 0.3; t < LENGTH; t += 0.9, i++) {
    const targets = squads.filter((m) => fit(m, t));
    const to = targets[(i * 5) % targets.length];
    if (to) events.push([t, { kind: 'shot', side: 'pact', from: CONTACTS[i % CONTACTS.length]!.id, to: to.id, hit: i % 4 === 1 }]);
  }
  i = 0;
  for (let t = start + 0.5; t < LENGTH; t += 1.5, i++) {
    const { x, y } = at(MEN[(i * 3) % 8]!.path, t);
    events.push([t, { kind: 'suppressive', side: 'pact', from: CONTACTS[2]!.id, x: x + ((i % 5) - 2) * 2, y: y + ((i % 3) - 1) * 2, hit: false }]);
  }
  return events;
}

/** Woundings, deaths, Revives, Squad Respawns and the Redeploy, read off the spans so they never drift from the views. */
function casualties(): [number, SimEvent][] {
  const events: [number, SimEvent][] = [];
  const side = 'nato';
  for (const m of MEN) {
    const sq = SQUADS.find((q) => q.id === m.squad)!;
    for (const [a, b] of m.wounded ?? []) {
      events.push([a, { kind: 'wounded', side, id: m.id, ...at(m.path, a) }]);
      const by = sq.members.find((id) => id !== m.id && !inSpan(MEN[id]!.wounded, b) && !inSpan(MEN[id]!.dead, b)) ?? sq.members[0]!;
      events.push([b, { kind: 'revived', side, id: m.id, by }]);
    }
    for (const [a, b] of m.dead ?? []) {
      events.push([a, { kind: 'death', side, id: m.id, ...at(m.path, a) }]);
      if (b < LENGTH && sq.wiped?.[1] !== b) events.push([b, { kind: 'respawn', side, id: m.id, ...at(m.path, b) }]);
    }
  }
  for (const q of SQUADS) if (q.wiped) events.push([q.wiped[1], { kind: 'redeploy', side, squad: q.id, ...HQ }]);
  return events;
}

const EVENTS: [number, SimEvent][] = [...casualties(), ...firefight()].sort((a, b) => a[0] - b[0]);
