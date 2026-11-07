// DEV-only Commander look review timeline (#69): a hand-written, deterministic script of CommanderViews and Events on
// Kaltenbach coordinates, so the Console's readability treatments (#70 firing pulse, #71 selection and Squad Leader
// markers), the Cruise Missile's marks (#99) and the tank (#107: sprite, turret, Wreck, badge, main gun) are judged on every
// Squad Leader state without a Simulation. `viewAt` and `eventsBetween` are pure.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView, EffectView, FriendlyView, SimEvent, SoldierView, SquadView, VehicleView } from '../../sim/types';

export const LENGTH = 92;

/** Where each state starts, for scrubbing. */
export const CHAPTERS = [
  { at: 0, title: 'Overlap' },
  { at: 10, title: 'Firing' },
  { at: 20, title: 'Wounded leader' },
  { at: 30, title: 'Leader down' },
  { at: 34, title: 'Cruise Missile' },
  { at: 50, title: 'Wipe' },
  { at: 62, title: 'Redeploy' },
  { at: 72, title: 'Tank' },
];

/** Centre of the overlapping Squads, for the close zoom preset. */
export const CLOSE_AT = { x: -66, y: 18 };

const HQ = { x: -415, y: 0 };
const HZ = DEFAULT_TUNE.hz;

// #99: a Cruise Missile called on the Contacts 10 s before the missile chapter, so the chapter opens on the edge-glued
// icon and the hit lands before the Wipe: it leaves from beyond the west edge behind the HQ (where the Simulation
// launches nato's) and flies straight at the spot at `missileSpeedMps`, so the edge-clamped icon, the line and the
// marker show at both zooms, then the shared impact takes over.
const MISSILE = { at: CHAPTERS[4]!.at - 10, from: { x: -1556, y: 0 }, to: { x: -16, y: 28 } };
const MISSILE_FLIGHT = Math.hypot(MISSILE.to.x - MISSILE.from.x, MISSILE.to.y - MISSILE.from.y) / DEFAULT_TUNE.missileSpeedMps;
const MISSILE_LANDS = MISSILE.at + MISSILE_FLIGHT;

function missileAt(t: number): EffectView[] {
  const contact = DEFAULT_TUNE.barrageContactSeconds;
  if (t < MISSILE.at || t >= MISSILE_LANDS + contact) return [];
  const flight = Math.min(1, (t - MISSILE.at) / MISSILE_FLIGHT);
  return [{ asset: 'missile', ...MISSILE.to, radius: DEFAULT_TUNE.missileSuppressM, left: MISSILE_LANDS + contact - t, total: MISSILE_FLIGHT + contact, impactIn: Math.max(0, MISSILE_LANDS - t), side: 'nato', from: MISSILE.from, flight }];
}

// #107: Charlie's first two board their tank where they stand and drive it east up the road; an enemy tank comes into sight
// by the bridge and the main gun fires on it twice, each round flying out to it. A nato Wreck from earlier lies by the road
// all along, and an abandoned nato tank (nobody aboard: the grey-white icon) stands off it.
const TANK_AT = CHAPTERS[7]!.at;
const TANK_ID = 30;
const ENEMY_TANK_ID = 31;
const TANK_PATH: Key[] = [[0, -150, -122], [TANK_AT + 2, -150, -122], [TANK_AT + 10, -96, -84], [TANK_AT + 14, -70, -76], [LENGTH, -70, -76]];
const ENEMY_TANK = { x: 34, y: -58, fx: -0.94, fy: -0.34 };
const SHOTS = [TANK_AT + 12, TANK_AT + 18];
const ROUND_S = 0.8; // each round's flight
const aboard = (id: number, t: number) => t >= TANK_AT && (id === 8 || id === 9);

function tanksAt(t: number): VehicleView[] {
  const wreck: VehicleView = { id: -1, side: 'nato', kind: 'tank', x: -126, y: -64, fx: 0.6, fy: 0.8, tx: 0.98, ty: 0.2, wreck: true };
  const p = at(TANK_PATH, t);
  const ahead = at(TANK_PATH, t + 0.5);
  const d = Math.hypot(ahead.x - p.x, ahead.y - p.y);
  const hull = d > 0.01 ? { fx: (ahead.x - p.x) / d, fy: (ahead.y - p.y) / d } : { fx: 0.96, fy: 0.28 };
  const seen = t >= TANK_AT + 6;
  const lay = Math.hypot(ENEMY_TANK.x - p.x, ENEMY_TANK.y - p.y);
  const turret = seen ? { tx: (ENEMY_TANK.x - p.x) / lay, ty: (ENEMY_TANK.y - p.y) / lay } : { tx: hull.fx, ty: hull.fy };
  const rounds = SHOTS.filter((s) => t >= s - ROUND_S && t < s).map((s) => ({ from: at(TANK_PATH, s - ROUND_S), to: { x: ENEMY_TANK.x, y: ENEMY_TANK.y }, flight: (t - s + ROUND_S) / ROUND_S }));
  const own: VehicleView = { id: TANK_ID, side: 'nato', kind: 'tank', ...p, ...hull, ...turret, hp: t >= SHOTS[1]! ? 0.65 : 1, seats: t >= TANK_AT ? [8, 9] : [-1, -1], ...(t < TANK_AT && { empty: true }), ...(rounds.length && { rounds }) };
  const enemy: VehicleView = { id: ENEMY_TANK_ID, side: 'pact', kind: 'tank', ...ENEMY_TANK, tx: -0.99, ty: -0.12 };
  const abandoned: VehicleView = { id: 32, side: 'nato', kind: 'tank', x: -112, y: -40, fx: -0.3, fy: 0.95, tx: 0.5, ty: 0.87, hp: 0.3, seats: [-1, -1], empty: true };
  return [wreck, own, abandoned, ...(seen ? [enemy] : [])];
}

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
// Charlie (8..11) holds south-west. Contacts (20..22) are 50 m east, facing them. #54: the Squad Leader is the first
// roster member for the whole Match, so Alpha's leader id 0 is Wounded, then dies and Squad Respawns at 40 s.
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
  { id: 8, squad: 2, path: [[0, -150, -118]], fx: 0.7, fy: 0.7 },
  { id: 9, squad: 2, path: [[0, -142, -126]], fx: 0.7, fy: 0.7 },
  { id: 10, squad: 2, path: [[0, -158, -128]], fx: 0.7, fy: 0.7 },
  { id: 11, squad: 2, path: [[0, -146, -136]], fx: 0.7, fy: 0.7 },
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
  wiped?: Span;
}
const SQUADS: Sq[] = [
  { id: 0, name: 'Alpha', members: [0, 1, 2, 3] },
  { id: 1, name: 'Bravo', members: [4, 5, 6, 7], wiped: [50, 62] },
  { id: 2, name: 'Charlie', members: [8, 9, 10, 11] },
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
  const leader = inSpan(men[0]!.dead, t) ? null : men[0]!.id; // the first roster member, as the Simulation's rule (#68, #54)
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
    ...(aboard(m.id, t) && { ...at(TANK_PATH, t), vehicle: TANK_ID }),
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
    assets: [{ asset: 'missile', readyIn: t < MISSILE.at ? 0 : Math.max(0, MISSILE.at + DEFAULT_TUNE.missileCooldownSeconds - t), cooldown: DEFAULT_TUNE.missileCooldownSeconds, radius: DEFAULT_TUNE.missileSuppressM }],
    effects: missileAt(t),
    vehicles: tanksAt(t),
  };
}

/** Events with `t0 < time <= t1`, in time order: what crossed since the last frame while playing. */
export function eventsBetween(t0: number, t1: number): SimEvent[] {
  return EVENTS.filter(([t]) => t > t0 && t <= t1).map(([, e]) => e);
}

/** Fit to fire at `t`: not down, and not going down within the next second (so the shooter is still drawn when the tracer lands). */
const fit = (m: Man, t: number) => !inSpan(m.dead, t) && !inSpan(m.wounded, t) && !inSpan(m.dead, t + 1) && !inSpan(m.wounded, t + 1);

/** The firefight: from the Firing chapter on, Alpha and Bravo trade fire with the Contacts; both sides also fire suppressive at the other's ground. */
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
  i = 0;
  for (let t = start + 0.8; t < LENGTH; t += 1.8, i++) {
    const from = squads.filter((m) => fit(m, t))[(i * 7) % 8];
    const { x, y } = at(CONTACTS[i % CONTACTS.length]!.path, t);
    if (from) events.push([t, { kind: 'suppressive', side: 'nato', from: from.id, x: x + ((i % 3) - 1) * 3, y: y + ((i % 5) - 2) * 2, hit: false }]);
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

/** #99: the missile's radio lines and its impact. */
const strike = (): [number, SimEvent][] => [
  [MISSILE.at, { kind: 'radio', side: 'nato', squad: null, type: 'asset', text: 'Missile away', grid: 'G7', priority: 1 }],
  [MISSILE_LANDS, { kind: 'impact', side: 'nato', ...MISSILE.to, asset: 'missile' }],
  [MISSILE_LANDS, { kind: 'radio', side: 'nato', squad: null, type: 'asset', text: 'Splash', grid: 'G7', priority: 1 }],
];

/** #107: the tank's main gun on the enemy tank: the shared explosion, crater and plume. */
const gun = (): [number, SimEvent][] => SHOTS.map((t) => [t, { kind: 'impact', side: 'nato', x: ENEMY_TANK.x, y: ENEMY_TANK.y, asset: 'tank', from: TANK_ID }]);

const EVENTS: [number, SimEvent][] = [...casualties(), ...firefight(), ...strike(), ...gun()].sort((a, b) => a[0] - b[0]);
