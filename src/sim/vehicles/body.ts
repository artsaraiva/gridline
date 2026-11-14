// The Vehicle body every kind shares (#107, ADR 0005): its record, what each kind is (`SPECS`, #183) and the class predicates
// read off it, a fresh one in its slot, its Wreck, and an EMP Strike's hold (#143).
import type { Match } from '../index';
import type { AirMissile, Lock } from '../air-missiles';
import { enemyOf, type MapData, type SideId, type Tune, type Vec2, type VehicleKind } from '../types';
import type { Drive } from './drive-route';
import type { Heli } from './helicopter';
import type { Sortie } from './jet';
import type { Gun } from './tank';

/** #183: what every Vehicle kind's body holds, each field one thing for every kind; what only one kind needs is in its own record (`Own`). */
interface Body {
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
  target: number; // what its turret is laid on: its gun's target id (Soldier or vehicle), -1 = none; #110 an AA's gun target (air first, else a light vehicle)
  coax: number; // the infantry target of its second gun (the coax or MG), -1 = none; #110 an AA's infantry target
  rounds: Round[]; // main gun rounds (#110 a jet's bombs) in the air (they land even if it dies meanwhile)
  bias: number[]; // its driver's seeded preference per Capture Point, drawn when the driver boards
  point: number; // #108 index of the Capture Point whose owner it appears for, -1 = an HQ slot
  movedAt: number; // #108 last tick it moved
  halt: number; // #108 tick it stopped for someone to get out, -1 = not stopping
  airborne: boolean; // in the air: #109 a helicopter off the ground, #110 a jet off its base, #101 #139 a lent body while its Asset flies it
  claim: number; // #122 id of the Squad whose riders are walking to it, -1 = none
  claimUntil: number; // #122 tick the claim runs out
  missiles: AirMissile[]; // #110 lock-on missiles it fired, in flight (they fly on if it dies)
  disabledUntil: number; // #143 the first tick an EMP Strike no longer holds it (`held`); 0 = never held
}

/** #183: each kind's own record beside the body, named for what it holds; a lent body has none (its state is its Asset's). */
interface Own {
  tank: { gun: Gun; drive: Drive };
  jeep: { drive: Drive };
  aa: { burstUntil: number; missile: Lock; drive: Drive }; // #110 `burstUntil`: the tick its gun's burst ends, -1 = none on
  helicopter: { heli: Heli };
  jet: { sortie: Sortie; missile: Lock };
  gunship: object;
  drone: object;
  recon: object;
}
/** #183: the record of a vehicle of `kind` beside its body (its kind's `init`). */
export type OwnOf<K extends VehicleKind> = Own[K];
/** #183: a vehicle of kind `K` (of each kind, for a union): the body, and its kind's own record. */
export type VehicleOf<K extends VehicleKind> = K extends VehicleKind ? Body & { kind: K } & Own[K] : never;
/** A Vehicle of any kind. */
export type Vehicle = VehicleOf<VehicleKind>;
/** #107 #108 #110: a vehicle on the ground grid, driven by the shared drive step (ground.ts). */
export type Ground = VehicleOf<'tank' | 'jeep' | 'aa'>;

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

/**
 * #183: what a Vehicle kind is, one row of `SPECS`. Its `layer` is where it moves: `ground`, on the ground grid, steered by the
 * shared drive step (ground.ts) with its `handling`; `low`, #109 the helicopter's air layer (off the grid, eyes over walls, seen
 * over walls while airborne); `high`, #110 #101 #139 up where only an AA sees it and hurts it, and only over the Play Area. An
 * aircraft flies by its own module's rules, so only a ground kind has (and must have) handling.
 */
type VehicleSpec = {
  hp: Stat;
  seats: number; // seat 0 drives (or pilots), seat 1 fires the second gun, any more ride
  roadMps: Stat;
  openMps: Stat;
  gunSeconds: Stat; // the second seat's gun (the tank's coax, the jeep's MG, #109 the door gun, #110 the jet's cannon and the AA's burst)
  gunM: Stat;
  perSide: (t: Tune, map: MapData, side: SideId) => number | null; // #154: each Side's count, null = one per slot the map gives it (`slots`)
  slots: (map: MapData, side: SideId) => Vec2[]; // #154: where the map puts a Side's ones; none for an aircraft at the off-map base
  lent: boolean; // #101 #139: its Asset flies it, wakes it and puts it to sleep; the vehicle phase leaves it alone
  leavesWreck: boolean; // #139: a drone or the Recon Plane leaves none (too small to block a road or to mark the map)
  ridersBail: boolean; // #101: everyone aboard bails out as it is shot down, instead of dying with it
  armour: boolean; // #107 #110: a tank's round only damages it (`tankVsVehicleDamage`), and rifles never fire on it; #108 anything lighter dies of a round and is a rifle target
} & ({ layer: 'ground'; handling: { accel: Stat; turnDegPerS: Stat } } | { layer: 'low' | 'high'; handling?: never });

/** #154: the map's vehicle slots of `kind` for a Side. */
const slotted = (kind: VehicleKind) => (map: MapData, side: SideId): Vec2[] => (map.vehicleSlots?.[side] ?? []).filter((s) => s.kind === kind);
const none = (): Vec2[] => [];

/** #183: what each Vehicle kind is, one row a kind; the class predicates below read it. A new kind fails the typecheck until it has a row, a ground kind until it has its handling. */
export const SPECS: { [K in VehicleKind]: VehicleSpec } = {
  tank: {
    hp: (t) => t.tankHp, seats: 2, roadMps: (t) => t.tankRoadMps, openMps: (t) => t.tankOpenMps, gunSeconds: (t) => t.coaxFireSeconds, gunM: (t) => t.coaxRangeM,
    handling: { accel: (t) => t.tankAccel, turnDegPerS: (t) => t.tankTurnDegPerS }, layer: 'ground', perSide: (t) => t.tanksPerSide, slots: slotted('tank'), lent: false, leavesWreck: true, ridersBail: false, armour: true,
  },
  jeep: {
    hp: (t) => t.jeepHp, seats: 4, roadMps: (t) => t.jeepRoadMps, openMps: (t) => t.jeepOpenMps, gunSeconds: (t) => t.mgFireSeconds, gunM: (t) => t.mgRangeM,
    handling: { accel: (t) => t.jeepAccel, turnDegPerS: (t) => t.jeepTurnDegPerS }, layer: 'ground', perSide: (t) => t.jeepsPerSide, slots: slotted('jeep'), lent: false, leavesWreck: true, ridersBail: false, armour: false,
  },
  helicopter: {
    hp: (t) => t.heliHp, seats: 6, roadMps: (t) => t.heliMps, openMps: (t) => t.heliMps, gunSeconds: (t) => t.mgFireSeconds, gunM: (t) => t.mgRangeM,
    layer: 'low', perSide: (t) => t.helisPerSide, slots: (map, side) => map.helipad?.[side] ?? [], lent: false, leavesWreck: true, ridersBail: false, armour: false, // #109: its slots are its helipads
  },
  jet: {
    hp: (t) => t.jetHp, seats: 1, roadMps: (t) => t.jetMps, openMps: (t) => t.jetMps, gunSeconds: (t) => t.jetFireSeconds, gunM: () => 0,
    layer: 'high', perSide: (t, map, side) => t.jetsPerSide ?? map.jets?.[side] ?? 0, slots: none, lent: false, leavesWreck: true, ridersBail: false, armour: false, // #154: else the map's `jets`, at the off-map base
  },
  aa: {
    hp: (t) => t.aaHp, seats: 1, roadMps: (t) => t.aaRoadMps, openMps: (t) => t.aaOpenMps, gunSeconds: (t) => t.aaFireSeconds, gunM: (t) => t.aaGroundRangeM,
    handling: { accel: (t) => t.tankAccel, turnDegPerS: (t) => t.tankTurnDegPerS }, layer: 'ground', perSide: (t) => t.aasPerSide, slots: slotted('aa'), lent: false, leavesWreck: true, ridersBail: false, armour: true, // #110: an AA handles as a tank
  },
  gunship: { // #101: the pilot's seat stays empty (its Asset flies it), then the gun seat and four passengers; one a Side, whatever the map
    hp: (t) => t.gunshipHp, seats: 6, roadMps: (t) => t.gunshipSpeedMps, openMps: (t) => t.gunshipSpeedMps, gunSeconds: (t) => t.mgFireSeconds, gunM: (t) => t.gunshipRangeM,
    layer: 'high', perSide: () => 1, slots: none, lent: true, leavesWreck: true, ridersBail: true, armour: false,
  },
  drone: { // #139: nobody aboard, no gun; one a Side
    hp: (t) => t.droneHp, seats: 0, roadMps: (t) => t.droneSpeedMps, openMps: (t) => t.droneSpeedMps, gunSeconds: () => 0, gunM: () => 0,
    layer: 'high', perSide: () => 1, slots: none, lent: true, leavesWreck: false, ridersBail: false, armour: false,
  },
  recon: { // #139: likewise, the Recon Plane
    hp: (t) => t.reconHp, seats: 0, roadMps: (t) => t.reconSpeedMps, openMps: (t) => t.reconSpeedMps, gunSeconds: () => 0, gunM: () => 0,
    layer: 'high', perSide: () => 1, slots: none, lent: true, leavesWreck: false, ridersBail: false, armour: false,
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

/** A vehicle's body as it stands fresh in its slot (#110: a jet's is the off-map base); its kind's own record is its `init` (vehicles/core.ts `renew`). */
export const fresh = <K extends VehicleKind>(m: Match, side: SideId, kind: K, slot: Vec2) => ({
  side, kind, ...slot, fx: side === 'nato' ? 1 : -1, fy: 0, speed: 0, hp: SPECS[kind].hp(m.tune), seats: Array<number>(SPECS[kind].seats).fill(-1), slot,
  parked: true, deadAt: -1, goal: -1, departAt: 0, target: -1, coax: -1, bias: [] as number[], movedAt: m.tick, halt: -1, airborne: false, claim: -1, claimUntil: 0, disabledUntil: 0,
});

/** #143: an EMP Strike holds `v`: it neither moves (a helicopter hangs where it is in the air) nor fires, nor does a helicopter change its job. Its riders are untouched. */
export const held = (m: Match, v: Vehicle) => m.tick < v.disabledUntil;
/** #143: an EMP Strike holds `v` until the tick `until`; a second one over it holds it as long as the later says. */
export const hold = (v: Vehicle, until: number) => void (v.disabledUntil = Math.max(v.disabledUntil, until));

/** `v` is destroyed where it is: a Wreck, seen by the enemy only if they saw it in the last perception phase (#119: in the air too); #101 a lent body (the Gunship) falls in both Sides' sky. #139: a drone or the Recon Plane leaves none (too small to block a road or to mark the map). */
export function wreck(m: Match, v: Vehicle) {
  if (!SPECS[v.kind].leavesWreck) return void Object.assign(v, { hp: 0, deadAt: m.tick, airborne: false });
  const seen = SPECS[v.kind].lent || m.sightings[enemyOf(v.side)].some((o) => o.id === v.id && o.tick >= m.tick - 1);
  m.wrecks.push({ side: v.side, kind: v.kind, x: v.x, y: v.y, fx: v.fx, fy: v.fy, seen, tick: m.tick });
  Object.assign(v, { hp: 0, deadAt: m.tick, target: -1, coax: -1, airborne: false });
}
