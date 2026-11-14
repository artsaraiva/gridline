// The Vehicle body every kind shares (#107, ADR 0005): its record, what each kind is (`SPECS`, #183) and the class predicates
// read off it, a fresh one in its slot, its Wreck, and an EMP Strike's hold (#143).
import type { Match } from '../index';
import type { AirMissile } from '../air-missiles';
import { enemyOf, type SideId, type Tune, type Vec2, type VehicleKind } from '../types';
import type { Job } from './helicopter-jobs';
import type { Sortie } from './jet';

export interface Vehicle {
  id: number;
  side: SideId;
  kind: VehicleKind;
  x: number;
  y: number;
  fx: number; // unit hull facing
  fy: number;
  speed: number; // #123 m/s along the facing; a fresh one stands still
  hp: number;
  seats: number[]; // Soldier ids, -1 free; seat 0 drives (and fires a tank's main gun), seat 1 is the gunner on the coax or MG, any more ride; #129 a helicopter's: pilot, left gun, right gun, three passengers
  slot: Vec2; // where it waits at the start and a fresh one appears
  parked: boolean; // standing at its goal, or waiting for riders
  deadAt: number; // tick it was destroyed, -1 = live, DORMANT = a point's slot that has never had one
  goal: number; // index of the Capture Point it drives to (its driver's), -1 = none
  departAt: number; // tick a fresh driver leaves with free seats
  target: number; // main gun target id (Soldier or vehicle), -1 = none; #110 an AA's gun target (air first, else a light vehicle)
  coax: number; // coax (or MG) target Soldier id, -1 = none; #110 an AA's infantry target
  nextFire: number; // tick the main gun may fire again; #110 an AA's or a jet's missile, once locked and reloaded
  rounds: Round[]; // main gun rounds in the air (they land even if it dies meanwhile)
  laid: number; // the target the main gun last laid on, -1 = none; a new one costs the aim time; #110 the missile's lock
  bias: number[]; // its driver's seeded preference per Capture Point, drawn when the driver boards
  point: number; // #108 index of the Capture Point whose owner it appears for, -1 = an HQ slot
  movedAt: number; // #108 last tick it moved
  halt: number; // #108 tick it stopped for someone to get out, -1 = not stopping
  airborne: boolean; // #109 a helicopter in the air
  landedAt: number; // #109 tick a helicopter last touched down, -1 = not since it was fresh
  claim: number; // #122 id of the Squad whose riders are walking to it, -1 = none
  claimUntil: number; // #122 tick the claim runs out
  lz: Vec2 | null; // #124 a helicopter's Landing Zone for its trip out (kept after touchdown: its passengers get out there), null = none yet
  wp: Vec2 | null; // #124 the waypoint of its dogleg still ahead, null = none (or passed)
  flareUntil: number; // #124 tick it touches down after hovering over its Landing Zone or slot, -1 = not hovering
  spoolUntil: number; // #124 tick its rotor is up and it lifts off, -1 = not spooling
  job: Job; // #131 what a helicopter is doing, decided at its pilot's Squad think
  fetch: number; // #131 id of the Squad it is flying to fetch, -1 = none
  spot: Vec2 | null; // #131 the pickup Landing Zone it is bound for (fetching), or the centre it circles (Support, or over a hot goal)
  spin: number; // #131 which way round it circles: 1 counter-clockwise (the centre on its left), -1 clockwise
  until: number; // #131 tick its Support Commitment ends, or its orbit over a hot goal (-1 = not begun); #110 an AA's gun burst ends (-1 = none on)
  drop: boolean; // #131 its riders jump over their Landing Zone (a hot goal) instead of landing; #110 a jet's pass drops a bomb
  crashAt: number; // #131 tick a helicopter bailed out of hits the ground, -1 = not going down
  sortie: Sortie; // #110 where a jet is in its sortie (`jet.ts`); a jet's `spot` is its pass's point, `until` the tick its turn or rearm ends, `spin` its turn's way round
  passes: number; // #110 a jet's passes left in the sortie
  route: number; // a ground vehicle's way to its goal (drive-route.ts): -1 not chosen, 0 by its road, 1 + c over crossing c first
  planAt: number; // tick its driver may next plan a detour (drive-route.ts)
  path: Vec2[]; // the cells still ahead of a detour round known danger (drive-route.ts), followed before the route; empty = none
  bombs: number; // #110 a jet's bombs left in the sortie
  prey: number; // #110 a jet's mark: the enemy its pass is aimed at, or the enemy jet it fights; -1 = none
  missiles: AirMissile[]; // #110 lock-on missiles it fired, in flight (they fly on if it dies)
  disabledUntil: number; // #143 the first tick an EMP Strike no longer holds it (`held`); 0 = never held
}

/** A main gun round: fired from (x0, y0) at tick `launch`, landing on (x, y) at tick `land`. */
export interface Round {
  x0: number;
  y0: number;
  x: number;
  y: number;
  launch: number;
  land: number;
  bomb?: boolean; // #110 a jet's bomb, not a main gun round
}

/** A destroyed vehicle where it died, for the rest of the Match. `seen`: the enemy saw it die. */
export interface Wreck {
  side: SideId;
  kind: VehicleKind;
  x: number;
  y: number;
  fx: number;
  fy: number;
  seen: boolean;
  tick: number; // when it was destroyed: a fresh one warns drivers off its road
}

/** #108: a point's slot before the point first has an owner. */
export const DORMANT = -2;
export const live = (v: Vehicle) => v.deadAt === -1;
export const riders = (m: Match, v: Vehicle) => v.seats.filter((id) => id >= 0).map((id) => m.soldiers[id]!);

/** A number a Vehicle kind reads off the Tune. */
type Stat = (t: Tune) => number;

/** #183: what a Vehicle kind is, one row of `SPECS`. */
export interface Spec {
  hp: Stat;
  seats: number; // seat 0 drives (or pilots), seat 1 fires the second gun, any more ride
  roadMps: Stat;
  openMps: Stat;
  gunSeconds: Stat; // the second seat's gun (the tank's coax, the jeep's MG, #109 the door gun, #110 the jet's cannon and the AA's burst)
  gunM: Stat;
  handling?: { accel: Stat; turnDegPerS: Stat }; // a ground kind's, in the shared drive step (ground.ts); the aircraft fly by their own module's rules
  /** Where it moves: on the ground grid; `low`, #109 the helicopter's air layer (off the grid, eyes over walls, seen over walls while airborne); `high`, #110 #101 #139 up where only an AA sees it and hurts it, and only over the Play Area. */
  layer: 'ground' | 'low' | 'high';
  perSide: (t: Tune) => number | null; // #154: each Side's count, null = the map's (`countOf`)
  lent: boolean; // #101 #139: its Asset flies it, wakes it and puts it to sleep; the vehicle phase leaves it alone
  leavesWreck: boolean; // #139: a drone or the Recon Plane leaves none (too small to block a road or to mark the map)
  ridersBail: boolean; // #101: everyone aboard bails out as it is shot down, instead of dying with it
}

/** #183: what each Vehicle kind is, one row a kind; the class predicates below read it. A new kind fails the typecheck until it has a row. */
export const SPECS: { [K in VehicleKind]: Spec } = {
  tank: {
    hp: (t) => t.tankHp, seats: 2, roadMps: (t) => t.tankRoadMps, openMps: (t) => t.tankOpenMps, gunSeconds: (t) => t.coaxFireSeconds, gunM: (t) => t.coaxRangeM,
    handling: { accel: (t) => t.tankAccel, turnDegPerS: (t) => t.tankTurnDegPerS }, layer: 'ground', perSide: (t) => t.tanksPerSide, lent: false, leavesWreck: true, ridersBail: false,
  },
  jeep: {
    hp: (t) => t.jeepHp, seats: 4, roadMps: (t) => t.jeepRoadMps, openMps: (t) => t.jeepOpenMps, gunSeconds: (t) => t.mgFireSeconds, gunM: (t) => t.mgRangeM,
    handling: { accel: (t) => t.jeepAccel, turnDegPerS: (t) => t.jeepTurnDegPerS }, layer: 'ground', perSide: (t) => t.jeepsPerSide, lent: false, leavesWreck: true, ridersBail: false,
  },
  helicopter: {
    hp: (t) => t.heliHp, seats: 6, roadMps: (t) => t.heliMps, openMps: (t) => t.heliMps, gunSeconds: (t) => t.mgFireSeconds, gunM: (t) => t.mgRangeM,
    layer: 'low', perSide: (t) => t.helisPerSide, lent: false, leavesWreck: true, ridersBail: false,
  },
  jet: {
    hp: (t) => t.jetHp, seats: 1, roadMps: (t) => t.jetMps, openMps: (t) => t.jetMps, gunSeconds: (t) => t.jetFireSeconds, gunM: () => 0,
    layer: 'high', perSide: (t) => t.jetsPerSide, lent: false, leavesWreck: true, ridersBail: false,
  },
  aa: {
    hp: (t) => t.aaHp, seats: 1, roadMps: (t) => t.aaRoadMps, openMps: (t) => t.aaOpenMps, gunSeconds: (t) => t.aaFireSeconds, gunM: (t) => t.aaGroundRangeM,
    handling: { accel: (t) => t.tankAccel, turnDegPerS: (t) => t.tankTurnDegPerS }, layer: 'ground', perSide: (t) => t.aasPerSide, lent: false, leavesWreck: true, ridersBail: false, // #110: an AA handles as a tank
  },
  gunship: { // #101: the pilot's seat stays empty (its Asset flies it), then the gun seat and four passengers; one a Side, whatever the map
    hp: (t) => t.gunshipHp, seats: 6, roadMps: (t) => t.gunshipSpeedMps, openMps: (t) => t.gunshipSpeedMps, gunSeconds: (t) => t.mgFireSeconds, gunM: (t) => t.gunshipRangeM,
    layer: 'high', perSide: () => 1, lent: true, leavesWreck: true, ridersBail: true,
  },
  drone: { // #139: nobody aboard, no gun; one a Side
    hp: (t) => t.droneHp, seats: 0, roadMps: (t) => t.droneSpeedMps, openMps: (t) => t.droneSpeedMps, gunSeconds: () => 0, gunM: () => 0,
    layer: 'high', perSide: () => 1, lent: true, leavesWreck: false, ridersBail: false,
  },
  recon: { // #139: likewise, the Recon Plane
    hp: (t) => t.reconHp, seats: 0, roadMps: (t) => t.reconSpeedMps, openMps: (t) => t.reconSpeedMps, gunSeconds: () => 0, gunM: () => 0,
    layer: 'high', perSide: () => 1, lent: true, leavesWreck: false, ridersBail: false,
  },
};

/** #139: the small aircraft an Asset flies with nobody aboard: the Drone Strike's drone and the Recon Plane. */
export const unmanned = (v?: { kind: VehicleKind }) => !!v && SPECS[v.kind].seats === 0;
/** #101 #139: its Asset flies it, wakes it and puts it to sleep; the vehicle phase leaves it alone. */
export const flown = (v: { kind: VehicleKind }) => SPECS[v.kind].lent;
/** #110: the air class: what an AA's eyes see over walls and its missile locks on. #101: the Gunship too, #139 a drone and the Recon Plane. */
export const flies = (v?: Vehicle) => !!v && SPECS[v.kind].layer !== 'ground';
/** #110 #101 #139: up where only an AA sees it and hurts it, and only over the Play Area: a jet, the Gunship, a drone or the Recon Plane. */
export const high = (v: { kind: VehicleKind }) => SPECS[v.kind].layer === 'high';

/** Under a third of its hit points: everyone gets out, nobody gets in. */
export const crippled = (m: Match, v: Vehicle) => v.hp < SPECS[v.kind].hp(m.tune) / 3;
/** #109: the air layer: off the ground grid, eyes over walls. */
export const air = (v: Vehicle) => SPECS[v.kind].layer === 'low';

/** A vehicle as it stands fresh in its slot (#110: a jet's is the off-map base). */
export const fresh = (m: Match, side: SideId, kind: VehicleKind, slot: Vec2) => ({
  side, kind, ...slot, fx: side === 'nato' ? 1 : -1, fy: 0, speed: 0, hp: SPECS[kind].hp(m.tune), seats: Array<number>(SPECS[kind].seats).fill(-1), slot,
  parked: true, deadAt: -1, goal: -1, departAt: 0, target: -1, coax: -1, nextFire: 0, laid: -1, bias: [] as number[], movedAt: m.tick, halt: -1,
  airborne: false, landedAt: -1, claim: -1, claimUntil: 0, lz: null as Vec2 | null, wp: null as Vec2 | null, flareUntil: -1, spoolUntil: -1,
  job: 'wait' as Job, fetch: -1, spot: null as Vec2 | null, spin: 1, until: -1, drop: false, crashAt: -1, sortie: 'idle' as Sortie, passes: 0, bombs: 0, prey: -1, route: -1, planAt: 0, path: [] as Vec2[],
  disabledUntil: 0,
});

/** #143: an EMP Strike holds `v`: it neither moves (a helicopter hangs where it is in the air) nor fires, nor does a helicopter change its job. Its riders are untouched. */
export const held = (m: Match, v: Vehicle) => m.tick < v.disabledUntil;
/** #143: an EMP Strike holds `v` until the tick `until`; a second one over it holds it as long as the later says. */
export const hold = (v: Vehicle, until: number) => void (v.disabledUntil = Math.max(v.disabledUntil, until));

/** `v` is destroyed where it is: a Wreck, seen by the enemy only if they saw it in the last perception phase (#119: in the air too). #139: a drone or the Recon Plane leaves none (too small to block a road or to mark the map). */
export function wreck(m: Match, v: Vehicle) {
  if (!SPECS[v.kind].leavesWreck) return void Object.assign(v, { hp: 0, deadAt: m.tick, airborne: false });
  const seen = v.kind === 'gunship' || m.sightings[enemyOf(v.side)].some((o) => o.id === v.id && o.tick >= m.tick - 1);
  m.wrecks.push({ side: v.side, kind: v.kind, x: v.x, y: v.y, fx: v.fx, fy: v.fy, seen, tick: m.tick });
  Object.assign(v, { hp: 0, deadAt: m.tick, target: -1, coax: -1, airborne: false });
}
