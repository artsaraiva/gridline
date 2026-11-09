// DEV-only Commander look review timeline (#69): a hand-written, deterministic script of CommanderViews and Events on
// Kaltenbach coordinates, so the Console's readability treatments (#70 firing pulse, #71 selection and Squad Leader
// markers), the Cruise Missile's marks (#99), the tank (#107: sprite, turret, Wreck, badge, main gun), the jeep (#108:
// sprite, Wreck, badge, MG, dismount) and the transport helicopter (#109: lift-off, flight, landing, unload, home; #124: dogleg, flare, Landing Zone) are judged on every
// Squad Leader state without a Simulation. `viewAt` and `eventsBetween` are pure.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView, EffectView, FriendlyView, LastKnownView, SimEvent, SoldierView, SquadView, VehicleView } from '../../sim/types';

export const LENGTH = 170;

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
  { at: 92, title: 'Jeep' },
  { at: 112, title: 'Helicopter' },
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

// #108: Bravo, back from its Redeploy, walks to the jeep parked off the HQ (nobody aboard: grey-white), boards it and drives
// east; the gunner (Bravo's 5) fires the MG at the Contacts as it closes. It stops for a second and everyone gets out beside
// it. A nato jeep Wreck lies by the way, and an enemy jeep stands in sight past the centre.
const JEEP_AT = CHAPTERS[8]!.at;
const JEEP_ID = 33;
const JEEP_PATH: Key[] = [[0, -372, 18], [JEEP_AT + 1, -372, 18], [JEEP_AT + 3, -342, 20], [JEEP_AT + 13, -152, 26], [JEEP_AT + 14, -140, 26], [LENGTH, -140, 26]];
const JEEP_OUT = JEEP_AT + 15; // a second's stop, then the dismount
const MG_FROM = 5;
const inJeep = (id: number, t: number) => t >= JEEP_AT && t < JEEP_OUT && id >= 4 && id <= 7;

function jeepsAt(t: number): VehicleView[] {
  const p = at(JEEP_PATH, t);
  const ahead = at(JEEP_PATH, t + 0.5);
  const d = Math.hypot(ahead.x - p.x, ahead.y - p.y);
  const hull = d > 0.01 ? { fx: (ahead.x - p.x) / d, fy: (ahead.y - p.y) / d } : { fx: 1, fy: 0.05 };
  const aboard = t >= JEEP_AT && t < JEEP_OUT;
  const own: VehicleView = { id: JEEP_ID, side: 'nato', kind: 'jeep', ...p, ...hull, tx: hull.fx, ty: hull.fy, hp: 1, seats: aboard ? [4, 5, 6, 7] : [-1, -1, -1, -1], ...(!aboard && { empty: true }) };
  const wreck: VehicleView = { id: -1, side: 'nato', kind: 'jeep', x: -250, y: -22, fx: 0.8, fy: -0.6, tx: 0.8, ty: -0.6, wreck: true };
  const enemy: VehicleView = { id: 34, side: 'pact', kind: 'jeep', x: 40, y: 62, fx: -0.9, fy: -0.44, tx: -0.9, ty: -0.44 };
  return [own, wreck, ...(t >= JEEP_AT + 4 ? [enemy] : [])];
}

// #109: Delta waits by the nato helipad all along, beside the helicopter (nobody aboard: rotor still, grey-white). It boards,
// the rotor spools `spoolSeconds` and the helicopter lifts off a second later and flies a dogleg to D at `heliMps` (#124: banking
// through a waypoint to the side away from the Contacts at C, with the momentum's ramp up and down), hovers `flareSeconds` over
// its Landing Zone south of D, still in the air, touches down, sits `unloadSeconds` while Delta gets out and walks in to D, spools
// again and flies home with its pilot (Delta's 12) by a different dogleg, on the other side. #119: pact's lifts off as nato's does,
// flies straight to C, sets its Squad down and flies home; it shows only while Alpha sees it (a Soldier's sight of a vehicle, the
// widest reach of any friendly's here), then fades to a Last Known Position. A pact helicopter Wreck lies south of C.
// #129: Delta's pilot is joined on the left gun by Charlie's 11 (a crew member from another Squad, still Charlie's: it walks
// over from Charlie's ground and climbs in; the right gun stays unmanned). It sits out on the helicopter's left side, and its
// gun fires at the Lookout (a Contact the helicopter passes on that side) while it is within `mgRangeM` and `gunArcDeg`: the
// shot lines leave from the left side, never the nose.
const HELI_AT = CHAPTERS[9]!.at;
const HELI_ID = 35;
const PAD = { x: -409.01, y: 0.3 }; // Kaltenbach's nato helipad (map.json)
const D = { x: 0, y: -300 };
const LZ = { x: -30, y: -358 }; // 65 m from D, on the side away from the Contacts at C
const WAY_OUT = { x: -291, y: -255 }; // 0.2 of the trip off the middle of the line, west of it, away from C
const WAY_HOME = { x: -166, y: -122 }; // 0.15 of the trip off the middle, east of it
const leg = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y) / DEFAULT_TUNE.heliMps;
const RAMP = DEFAULT_TUNE.heliMps / (2 * DEFAULT_TUNE.heliAccel) + DEFAULT_TUNE.heliMps / (2 * DEFAULT_TUNE.heliAccel * DEFAULT_TUNE.brakeMul); // the time lost to speeding up and slowing down
/** Keys from `start` along `points` at heliMps, the ramp's time spread over the whole trip. */
function trip(start: number, points: { x: number; y: number }[]): Key[] {
  const total = points.slice(1).reduce((a, p, i) => a + leg(points[i]!, p), 0);
  let t = start;
  return points.map((p, i) => [i ? (t += ((leg(points[i - 1]!, p) / total) * (total + RAMP))) : start, p.x, p.y]);
}
const LIFT = HELI_AT + 1; // the rotor starts
const AIR = LIFT + DEFAULT_TUNE.spoolSeconds;
const OUT_TRIP = trip(AIR, [PAD, WAY_OUT, LZ]);
const ARRIVE = OUT_TRIP.at(-1)![0];
const LAND = ARRIVE + DEFAULT_TUNE.flareSeconds; // touchdown
const UNLOADED = LAND + DEFAULT_TUNE.unloadSeconds;
const AIR2 = UNLOADED + DEFAULT_TUNE.spoolSeconds;
const HOME_TRIP = trip(AIR2, [LZ, WAY_HOME, PAD]);
const HOME = HOME_TRIP.at(-1)![0];
const HELI_PATH: Key[] = [[0, PAD.x, PAD.y], [LIFT, PAD.x, PAD.y], ...OUT_TRIP, [LAND, LZ.x, LZ.y], [AIR2, LZ.x, LZ.y], ...HOME_TRIP, [LENGTH, PAD.x, PAD.y]];
const OUT = LAND + 1; // a second on the ground, then everyone but the pilot is out
const inHeli = (id: number, t: number) => t >= HELI_AT && (id === 12 || id === 11 || (t < OUT && id >= 13 && id <= 15));
const LOOKOUT: Man = { id: 23, squad: -1, path: [[0, -127, -222], [LENGTH, -127, -222]], fx: -1, fy: 0 }; // on the helicopter's left (north-east) of its leg out; a Contact from HELI_AT
const ENEMY_PAD = { x: 420.96, y: -0.72 };
const ENEMY_LZ = { x: 14, y: -14 }; // inside C, east of the Contacts
const ENEMY_LANDS = LIFT + leg(ENEMY_PAD, ENEMY_LZ);
const ENEMY_UNLOADED = ENEMY_LANDS + DEFAULT_TUNE.unloadSeconds;
const ENEMY_HOME = ENEMY_UNLOADED + leg(ENEMY_LZ, ENEMY_PAD);
const ENEMY_PATH: Key[] = [[0, ENEMY_PAD.x, ENEMY_PAD.y], [LIFT, ENEMY_PAD.x, ENEMY_PAD.y], [ENEMY_LANDS, ENEMY_LZ.x, ENEMY_LZ.y], [ENEMY_UNLOADED, ENEMY_LZ.x, ENEMY_LZ.y], [ENEMY_HOME, ENEMY_PAD.x, ENEMY_PAD.y], [LENGTH, ENEMY_PAD.x, ENEMY_PAD.y]];
const SIGHT = DEFAULT_TUNE.visionM * DEFAULT_TUNE.vehicleVisionMul;
// Alpha faces east and the helicopter is always east of it, so in its cone: range decides
const spotted = (t: number) => {
  const e = at(ENEMY_PATH, t);
  return MEN.some((m) => {
    const p = at(m.path, t);
    return m.squad === 0 && !inSpan(m.dead, t) && Math.hypot(p.x - e.x, p.y - e.y) <= SIGHT;
  });
};

/** Where Alpha last saw the enemy helicopter, fading over `lkpSeconds`; none while it is in sight or long gone. */
function lostHeli(t: number): LastKnownView[] {
  const lkp = DEFAULT_TUNE.lkpSeconds;
  if (spotted(t)) return [];
  for (let s = t - 1 / HZ; s > t - lkp; s -= 1 / HZ) if (spotted(s)) return [{ ...at(ENEMY_PATH, s), fade: 1 - (t - s) / lkp }];
  return [];
}

/** The nato helicopter's position and unit heading at `t`. */
function hullAt(t: number) {
  const p = at(HELI_PATH, t);
  const ahead = at(HELI_PATH, t + 0.5);
  let behind = at(HELI_PATH, t - 0.5);
  for (let back = 1; back < 8 && Math.hypot(p.x - behind.x, p.y - behind.y) < 0.01; back += 0.5) behind = at(HELI_PATH, t - back); // hovering or sitting: it keeps the heading it came in on
  const [dx, dy] = Math.hypot(ahead.x - p.x, ahead.y - p.y) > 0.01 ? [ahead.x - p.x, ahead.y - p.y] : [p.x - behind.x, p.y - behind.y];
  const d = Math.hypot(dx, dy);
  return { ...p, ...(d > 0.01 ? { fx: dx / d, fy: dy / d } : { fx: 1, fy: 0 }) };
}

const GUN_OUT_M = 2; // as the Simulation: a gun seat's Soldier sits this far out from the hull's centre
/** Where an aboard Soldier is: the hull's centre, or for the left gunner 2 m out to its left (heading east, left is +y). */
function seatAt(id: number, t: number) {
  const { fx, fy, ...p } = hullAt(t);
  return id === 11 ? { x: p.x - fy * GUN_OUT_M, y: p.y + fx * GUN_OUT_M } : p;
}

function helisAt(t: number): VehicleView[] {
  const { fx, fy, ...p } = hullAt(t);
  const hull = { fx, fy };
  const seats = [12, 11, -1, 13, 14, 15].map((id) => (inHeli(id, t) ? id : -1)); // pilot, left gun (Charlie's 11), right gun (unmanned), three passengers
  const flying = (t > AIR && t < LAND) || (t > AIR2 && t < HOME); // the flare hover is still in the air
  const own: VehicleView = { id: HELI_ID, side: 'nato', kind: 'helicopter', ...p, ...hull, tx: hull.fx, ty: hull.fy, hp: 1, seats, ...(seats[0] === -1 && { empty: true }), ...(flying && { airborne: true }) };
  const span = Math.hypot(ENEMY_LZ.x - ENEMY_PAD.x, ENEMY_LZ.y - ENEMY_PAD.y);
  const toC = { fx: (ENEMY_LZ.x - ENEMY_PAD.x) / span, fy: (ENEMY_LZ.y - ENEMY_PAD.y) / span };
  const heading = t < ENEMY_UNLOADED ? toC : { fx: -toC.fx, fy: -toC.fy };
  const enemyFlying = (t > LIFT && t < ENEMY_LANDS) || (t > ENEMY_UNLOADED && t < ENEMY_HOME);
  const enemy: VehicleView = { id: 36, side: 'pact', kind: 'helicopter', ...at(ENEMY_PATH, t), ...heading, tx: heading.fx, ty: heading.fy, ...(enemyFlying && { airborne: true }) };
  const wreck: VehicleView = { id: -1, side: 'pact', kind: 'helicopter', x: 70, y: -150, fx: -0.6, fy: 0.8, tx: -0.6, ty: 0.8, wreck: true };
  return [own, wreck, ...(spotted(t) ? [enemy] : [])];
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
  { id: 4, squad: 1, path: [[0, -72, 18], [50, -70, 19], [62, -400, 4], [92, -368, 14], [107, -134, 30], [LENGTH, -130, 32]], dead: [[50, 62]], ...east },
  { id: 5, squad: 1, path: [[0, -62, 20], [50, -60, 21], [62, -404, -4], [92, -370, 12], [107, -138, 20], [LENGTH, -134, 19]], dead: [[50, 62]], ...east },
  { id: 6, squad: 1, path: [[0, -54, 24], [50, -52, 25], [62, -410, 10], [92, -375, 22], [107, -144, 32], [LENGTH, -146, 34]], dead: [[50, 62]], ...east },
  { id: 7, squad: 1, path: [[0, -64, 8], [50, -62, 9], [62, -412, -8], [92, -376, 15], [107, -146, 21], [LENGTH, -150, 20]], dead: [[50, 62]], ...east },
  { id: 8, squad: 2, path: [[0, -150, -118]], fx: 0.7, fy: 0.7 },
  { id: 9, squad: 2, path: [[0, -142, -126]], fx: 0.7, fy: 0.7 },
  { id: 10, squad: 2, path: [[0, -158, -128]], fx: 0.7, fy: 0.7 },
  { id: 11, squad: 2, path: [[0, -146, -136], [50, -146, -136], [HELI_AT - 1, -410, 6], [LENGTH, -410, 6]], fx: 0.7, fy: 0.7 }, // #129: left gunner from t = HELI_AT
  { id: 12, squad: 3, path: [[0, -414, 8], [LENGTH, -414, 8]], ...east },
  { id: 13, squad: 3, path: [[0, -412, -7], [LAND, -412, -7], [OUT, LZ.x - 6, LZ.y + 4], [OUT + 20, -6, -292], [LENGTH, -4, -286]], ...east },
  { id: 14, squad: 3, path: [[0, -403, 9], [LAND, -403, 9], [OUT, LZ.x + 6, LZ.y + 6], [OUT + 20, 7, -295], [LENGTH, 10, -290]], ...east },
  { id: 15, squad: 3, path: [[0, -402, -8], [LAND, -402, -8], [OUT, LZ.x, LZ.y - 5], [OUT + 20, -2, -306], [LENGTH, 2, -310]], ...east },
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
  { id: 3, name: 'Delta', members: [12, 13, 14, 15] },
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
    ...(inJeep(m.id, t) && { ...at(JEEP_PATH, t), vehicle: JEEP_ID }),
    ...(inHeli(m.id, t) && { ...seatAt(m.id, t), vehicle: HELI_ID }),
  }));
  return {
    side: 'nato',
    tick: Math.round(t * HZ),
    seconds: t,
    friendlies,
    contacts: [...CONTACTS, ...(t >= HELI_AT ? [LOOKOUT] : [])].map((c) => soldier(c, t)),
    lastKnown: lostHeli(t),
    squads: SQUADS.map((q) => squadView(q, t)),
    points: POINTS,
    tickets: { nato: 150, pact: 150 },
    result: null,
    assets: [{ asset: 'missile', readyIn: t < MISSILE.at ? 0 : Math.max(0, MISSILE.at + DEFAULT_TUNE.missileCooldownSeconds - t), cooldown: DEFAULT_TUNE.missileCooldownSeconds, radius: DEFAULT_TUNE.missileSuppressM }],
    effects: missileAt(t),
    vehicles: [...tanksAt(t), ...jeepsAt(t), ...helisAt(t)],
  };
}

/** Events with `t0 < time <= t1`, in time order: what crossed since the last frame while playing. */
export function eventsBetween(t0: number, t1: number): SimEvent[] {
  return EVENTS.filter(([t]) => t > t0 && t <= t1).map(([, e]) => e);
}

/** Fit to fire at `t`: not down, and not going down within the next second (so the shooter is still drawn when the tracer lands); #108 not aboard the jeep. */
const fit = (m: Man, t: number) => !inSpan(m.dead, t) && !inSpan(m.wounded, t) && !inSpan(m.dead, t + 1) && !inSpan(m.wounded, t + 1) && !inJeep(m.id, t) && !inJeep(m.id, t + 1);

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

/** #108: the jeep's MG on the Contacts as it closes, a short burst at a time. */
function mg(): [number, SimEvent][] {
  const events: [number, SimEvent][] = [];
  let i = 0;
  for (let t = JEEP_AT + 9; t < JEEP_AT + 14; t += i % 4 === 3 ? 0.8 : 0.15, i++) events.push([t, { kind: 'shot', side: 'nato', from: MG_FROM, to: CONTACTS[i % 2]!.id, hit: i % 5 === 0 }]);
  return events;
}

/** #129: the left gun on the Lookout while it is within `mgRangeM` and `gunArcDeg` of the helicopter's left beam (the Simulation's test). */
function sideGun(): [number, SimEvent][] {
  const events: [number, SimEvent][] = [];
  const cos = Math.cos((DEFAULT_TUNE.gunArcDeg / 2 / 180) * Math.PI);
  let i = 0;
  for (let t = HELI_AT; t < LAND; t += i % 4 === 3 ? 0.8 : 0.2, i++) {
    const h = hullAt(t);
    const d = Math.hypot(LOOKOUT.path[0]![1] - h.x, LOOKOUT.path[0]![2] - h.y);
    if (d <= DEFAULT_TUNE.mgRangeM && (LOOKOUT.path[0]![1] - h.x) * -h.fy + (LOOKOUT.path[0]![2] - h.y) * h.fx >= cos * d)
      events.push([t, { kind: 'shot', side: 'nato', from: 11, to: LOOKOUT.id, hit: i % 5 === 0 }]);
  }
  return events;
}

const EVENTS: [number, SimEvent][] = [...casualties(), ...firefight(), ...strike(), ...gun(), ...mg(), ...sideGun()].sort((a, b) => a[0] - b[0]);
