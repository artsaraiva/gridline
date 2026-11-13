// Vehicles (#107, the tank tracer for the shared rules of #27; ADR 0005): each Side's slot, seats, boarding and leaving per
// Soldier, the drive step, the tank's eyes and guns, the kill table, Wrecks and the respawn. #108 adds the jeep, a transport:
// its passengers get out by the shared passenger rule (`wantsOut`), and its second seat fires an MG where the tank's has the coax. Soldiers and vehicles share one
// id space: a vehicle's id comes after every Soldier's (`vehicleOf` in state.ts), so sightings, targets and `shot` events
// address either. #109 adds the transport helicopter: it flies over the ground grid (`fly`; #124 by dogleg, in `flight.ts`), ferries its passengers to their
// majority's goal and home again, sees over walls, and is seen over walls while airborne. #119: the enemy's Console shows it only
// when someone of theirs sees it, as any vehicle. #131: a piloted helicopter takes a job at its pilot's Squad think (`decideJob`):
// bail, repair, ferry (fetch a Squad that calls it, carry riders, drop them over a hot goal), support (circle a point) or wait.
// #110 adds the jet (its sortie in `jet.ts`: one pilot, attack runs and bombs from the off-map base, dogfights; only the AA and
// the enemy jet hurt it) and the AA: a ground vehicle crewed alone like a tank that lays back on rear and flank points, its gun
// firing bursts at air first (a jet over the Play Area, else a helicopter), else at infantry and light vehicles, and its lock-on
// missile (`air-missiles.ts`) at air. #101 adds the Gunship: one body per Side, dormant until its Asset (assets/gunship.ts)
// wakes it and flies it along its route. Nobody pilots it; a Soldier coming back may take its gun seat (the left side gun) or
// one of its passenger seats, to parachute out over its goal (`gunshipOnReturn`); everyone aboard bails out as it turns for
// home or is shot down. Only the AA sees and hurts it, as a helicopter, and only over the Play Area, as a jet.
import type { Match } from './index';
import { driveFlow, flowDist, flowLook } from './ai/flow';
import { bestPoint, reactAt } from './ai/squad';
import { between, rnd } from './rng';
import { blast } from './assets/strike';
import { die } from './combat';
import { approach, BRAKE_RESERVE, cosDeg, stopSpeed, turnToward } from './momentum';
import { canStand, dist2, inHq, insidePolygon, keystone } from './geometry';
import { dogleg, landingZone } from './flight';
import { launchPoint } from './assets/missile';
import { hashMissiles, type AirMissile } from './air-missiles';
import { jetPoint, SORTIE, sortie, takeOff, type Sortie } from './jet';
import { circle, decideJob, glide, JOBS, repairOnPad, spinFor, type Job } from './heli-jobs';
import { cellIndex, los, nearestWalkable, openRun } from './grid';
import { alongPath, overCrossing, pickRoute, routeFlow } from './drive-route';
import { see, sideKnown } from './memory';
import { footLeader, membersOf, ticksOf, vehicleOf, type Mix, type Soldier, type Squad } from './state';
import { enemyOf, SIDES, type SideId, type SimEvent, type Tune, type Vec2, type VehicleKind, type VehicleView } from './types';

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
const DORMANT = -2;
export const live = (v: Vehicle) => v.deadAt === -1;
export const riders = (m: Match, v: Vehicle) => v.seats.filter((id) => id >= 0).map((id) => m.soldiers[id]!);
const squared = (r: number) => r * r;

/** What each class is: hit points, seats, speeds, and the second seat's gun (the tank's coax, the jeep's MG, #109 the door gun). */
export const specOf = (t: Tune, kind: VehicleKind) =>
  kind === 'tank'
    ? { hp: t.tankHp, seats: 2, roadMps: t.tankRoadMps, openMps: t.tankOpenMps, gunSeconds: t.coaxFireSeconds, gunM: t.coaxRangeM }
    : kind === 'jeep'
      ? { hp: t.jeepHp, seats: 4, roadMps: t.jeepRoadMps, openMps: t.jeepOpenMps, gunSeconds: t.mgFireSeconds, gunM: t.mgRangeM }
      : kind === 'jet'
        ? { hp: t.jetHp, seats: 1, roadMps: t.jetMps, openMps: t.jetMps, gunSeconds: t.jetFireSeconds, gunM: 0 }
        : kind === 'aa'
          ? { hp: t.aaHp, seats: 1, roadMps: t.aaRoadMps, openMps: t.aaOpenMps, gunSeconds: t.aaFireSeconds, gunM: t.aaGroundRangeM }
          : kind === 'gunship' // #101: the pilot's seat stays empty (its Asset flies it), then the gun seat and four passengers
            ? { hp: t.gunshipHp, seats: 6, roadMps: t.gunshipSpeedMps, openMps: t.gunshipSpeedMps, gunSeconds: t.mgFireSeconds, gunM: t.gunshipRangeM }
            : kind === 'drone' // #139: nobody aboard, no gun
              ? { hp: t.droneHp, seats: 0, roadMps: t.droneSpeedMps, openMps: t.droneSpeedMps, gunSeconds: 0, gunM: 0 }
              : kind === 'recon'
                ? { hp: t.reconHp, seats: 0, roadMps: t.reconSpeedMps, openMps: t.reconSpeedMps, gunSeconds: 0, gunM: 0 }
            : { hp: t.heliHp, seats: 6, roadMps: t.heliMps, openMps: t.heliMps, gunSeconds: t.mgFireSeconds, gunM: t.mgRangeM };
/** #139: the small aircraft an Asset flies with nobody aboard: the Drone Strike's drone and the Recon Plane. */
const unmanned = (v?: { kind: VehicleKind }) => v?.kind === 'drone' || v?.kind === 'recon';
/** #101 #139: its Asset flies it, wakes it and puts it to sleep; the vehicle phase leaves it alone. */
const flown = (v: { kind: VehicleKind }) => v.kind === 'gunship' || unmanned(v);
/** #110: the air class: what an AA's eyes see over walls and its missile locks on. #101: the Gunship too, #139 a drone and the Recon Plane. */
export const flies = (v?: Vehicle) => v?.kind === 'helicopter' || v?.kind === 'jet' || v?.kind === 'gunship' || unmanned(v);
/** #110 #101 #139: up where only an AA sees it and hurts it, and only over the Play Area: a jet, the Gunship, a drone or the Recon Plane. */
export const high = (v: { kind: VehicleKind }) => v.kind === 'jet' || flown(v);
/** #101: the Gunship's gun seat; the passenger seats follow it. */
const GUNSHIP_GUN = 1;
/** Under a third of its hit points: everyone gets out, nobody gets in. */
export const crippled = (m: Match, v: Vehicle) => v.hp < specOf(m.tune, v.kind).hp / 3;
/** #109: the air layer: off the ground grid, eyes over walls. */
const air = (v: Vehicle) => v.kind === 'helicopter';
/** Who fires a ground vehicle's second-seat gun: seat 1. #129: a helicopter has a gun per side instead (`sideGun`). */
/** Helicopter seat indices: the pilot's, then the guns' (#129); the passenger seats follow. */
export const PILOT_SEAT = 0;
export const CREW_SEATS = [0, 1, 2];
export const gunner = (v: Vehicle) => v.seats[1]!;
/** #129: standing on its helipad (its slot), down. */
export const onPad = (v: Vehicle) => !v.airborne && dist2(v, v.slot) < 1;
/** Seats a passenger may take: all but a helicopter's pilot seat. */
const freeSeats = (v: Vehicle) => v.seats.filter((id, k) => id < 0 && (!air(v) || k > 0)).length;
/** How far a gun seat's Soldier sits out from the hull's centre, so its shot lines leave from that side: 2 m is about the half-width of a transport helicopter's body (a door gun sits at the hull's edge), far enough that the Console's line visibly leaves that side and not so far that a landed gunner stands outside a Capture Point the hull is in. */
const GUN_OUT_M = 2;
/** The unit vector straight out from the helicopter's `seat` side (1 left, 2 right; the field's y runs up, so left of east is +y), null for the other seats. */
const beam = (v: Vehicle, seat: number) => (seat === 1 ? { x: -v.fy, y: v.fx } : seat === 2 ? { x: v.fy, y: -v.fx } : null);

/** A vehicle as it stands fresh in its slot (#110: a jet's is the off-map base). */
const fresh = (m: Match, side: SideId, kind: VehicleKind, slot: Vec2) => ({
  side, kind, ...slot, fx: side === 'nato' ? 1 : -1, fy: 0, speed: 0, hp: specOf(m.tune, kind).hp, seats: Array<number>(specOf(m.tune, kind).seats).fill(-1), slot,
  parked: true, deadAt: -1, goal: -1, departAt: 0, target: -1, coax: -1, nextFire: 0, laid: -1, bias: [] as number[], movedAt: m.tick, halt: -1,
  airborne: false, landedAt: -1, claim: -1, claimUntil: 0, lz: null as Vec2 | null, wp: null as Vec2 | null, flareUntil: -1, spoolUntil: -1,
  job: 'wait' as Job, fetch: -1, spot: null as Vec2 | null, spin: 1, until: -1, drop: false, crashAt: -1, sortie: 'idle' as Sortie, passes: 0, bombs: 0, prey: -1, route: -1, planAt: 0, path: [] as Vec2[],
});

/**
 * The first fresh vehicles (#154: map data). Each Side's HQ tanks, jeeps (#108) and helicopters (#109), then the vehicles each
 * Capture Point lists (#108, `pointJeeps`: for its owner, dormant while it has none), then each Side's jets (#110, at its
 * off-map base) and AAs: last, so every earlier id stays put. A Side's count of a kind is the tune's, else the map's
 * (`countOf`); each waits in its own slot or helipad, and one past them in the Side's row (`rowSlot`).
 */
export function newVehicles(m: Match): Vehicle[] {
  const standing = (side: SideId, kind: VehicleKind, at: Vec2, point: number) => ({ ...fresh(m, side, kind, { x: at.x, y: at.y }), point, rounds: [] as Round[], missiles: [] as AirMissile[] });
  const nextInRow: Record<SideId, number> = { nato: 0, pact: 0 };
  const atHqs = (kinds: VehicleKind[]) =>
    SIDES.flatMap((side) => kinds.flatMap((kind) => Array.from({ length: countOf(m, side, kind) }, (_, i) => standing(side, kind, high({ kind }) ? launchPoint(m, side) : (slotsOf(m, side, kind)[i] ?? rowSlot(m, side, nextInRow[side]++)), -1))));
  const atPoints = m.tune.pointJeeps ? m.points.flatMap((p, i) => (m.map.points[i]!.vehicles ?? []).map((u) => ({ ...standing(p.owner ?? 'nato', u.kind, u, i), ...(!p.owner && { deadAt: DORMANT }) }))) : [];
  const gunships = [...atHqs(['gunship']), ...atHqs(['drone', 'recon'])].map((g) => ({ ...g, deadAt: DORMANT })); // #101: after those, asleep until its Asset is called; #139 then each Side's drone and Recon Plane, likewise
  return [...atHqs(['tank', 'jeep', 'helicopter']), ...atPoints, ...atHqs(['jet', 'aa']), ...gunships].map((v, i) => ({ ...v, id: m.soldiers.length + i }));
}

/** #101: the Gunship `v` wakes fresh where it waits (its Side's launch point), in the air, heading along (fx, fy). #139: a drone or the Recon Plane wakes at `at`. */
export const wake = (m: Match, v: Vehicle, fx: number, fy: number, at: Vec2 = v.slot) => Object.assign(v, fresh(m, v.side, v.kind, v.slot), { x: at.x, y: at.y, fx, fy, airborne: true, speed: specOf(m.tune, v.kind).openMps });
/** #101: the Gunship `v` home off the map: asleep again until its next call. #139: so a drone that has hit or been shot down, and the Recon Plane after its pass. */
export const sleep = (v: Vehicle) => Object.assign(v, { deadAt: DORMANT, airborne: false, speed: 0 });

/** #154: the map's slots of `kind` for `side` (a helicopter's are its helipads). */
const slotsOf = (m: Match, side: SideId, kind: VehicleKind): Vec2[] => (kind === 'helicopter' ? (m.map.helipad?.[side] ?? []) : (m.map.vehicleSlots?.[side] ?? []).filter((s) => s.kind === kind));

/** #154: a Side's count of `kind`: the tune's number, else the map's (its slots of that kind, or its `jets`). */
function countOf(m: Match, side: SideId, kind: VehicleKind): number {
  const t = m.tune;
  const n = { tank: t.tanksPerSide, jeep: t.jeepsPerSide, helicopter: t.helisPerSide, jet: t.jetsPerSide, aa: t.aasPerSide, gunship: 1, drone: 1, recon: 1 }[kind]; // #101: one Gunship a Side, whatever the map; #139 one drone and one Recon Plane
  return n ?? (kind === 'jet' ? (m.map.jets?.[side] ?? 0) : slotsOf(m, side, kind).length);
}

/** #154: spot `n` of a Side's row, for a vehicle the map has no slot for: 9 m apart toward the field past its last slot, or from the drivable ground nearest the HQ when it lists none. */
function rowSlot(m: Match, side: SideId, n: number): Vec2 {
  const listed = m.map.vehicleSlots?.[side] ?? [];
  const hq = m.map.hqs[side];
  const start = listed.at(-1) ?? nearestWalkable(m, { x: hq.x, y: hq.y }, m.drive[side]);
  const k = n + (listed.length ? 1 : 0);
  return k ? nearestWalkable(m, { x: start.x + (side === 'nato' ? 9 : -9) * k, y: start.y }, m.drive[side]) : start;
}

/** The Capture Point `s` is heading for: its own when Detached, else its Squad's; -1 when that is not a Capture Point. */
export const goalOf = (m: Match, sq: Squad, s: Soldier) => (s.detached && s.goal >= 0 ? s.goal : sq.task === 'point' ? sq.goal : -1);

/**
 * At its Squad's think: a Soldier on foot whose Capture Point is farther than `boardMinM` boards the nearest friendly tank
 * within `boardM` with a free seat that is empty (it drives, to its own goal) or whose driver's goal is within `sameWayM` of
 * its own; a tank with a squad mate aboard comes first. #122: only tanks; a Squad rides jeeps and helicopters together (`ride`).
 * #110: an AA boards as a tank (a jet's pilot never walks to it: see `jetOnReturn`).
 */
export function board(m: Match, sq: Squad, s: Soldier) {
  const t = m.tune;
  const goal = goalOf(m, sq, s);
  const p = m.points[goal];
  if (!p || s.reviving >= 0 || s.boarding >= 0 || dist2(s, p) <= squared(t.boardMinM)) return;
  let best: Vehicle | null = null;
  let bestKey = Infinity;
  for (const v of m.vehicles) {
    if ((v.kind !== 'tank' && v.kind !== 'aa') || v.side !== s.side || !live(v) || crippled(m, v) || !v.seats.includes(-1) || dist2(s, v) > squared(t.boardM)) continue;
    if (v.id === s.exited && v.seats.some((id) => id >= 0)) continue; // #108: not back into the ride it just left
    const driving = m.points[v.goal];
    if (v.seats[0]! >= 0 && (!driving || dist2(driving, p) > squared(t.sameWayM))) continue;
    const key = dist2(s, v) + (riders(m, v).some((o) => o.squad === s.squad) ? 0 : 1e9);
    if (key < bestKey) [best, bestKey] = [v, key];
  }
  if (best) mount(m, best, s, sq);
}

/**
 * `s` takes the first free seat of `v`. In the driver's seat it draws its own preference per Capture Point (seeded, kept for
 * the drive), picks its goal and starts the wait for others. #109: a helicopter's pilot picks no goal (`fly` ferries the
 * passengers'); its first passenger starts the wait for more.
 */
export function mount(m: Match, v: Vehicle, s: Soldier, sq: Squad) {
  const t = m.tune;
  const seat =
    v.kind === 'gunship' ? (s.crew ? GUNSHIP_GUN : v.seats.indexOf(-1, GUNSHIP_GUN + 1)) // #101: its gunner or a passenger; nobody takes the pilot's seat
    : air(v) ? (s.crew ? s.crewSeat : [3, 4, 5, 1, 2].find((k) => v.seats[k]! < 0)!) : v.seats.indexOf(-1); // #129: a helicopter's crew take the seat they were sent for (pilot, then guns); riders fill the passenger seats first
  const wait = m.tick + Math.round(t.boardWaitSeconds * t.hz);
  if (v.claim < 0 && air(v) && !s.crew && riders(m, v).every((o) => o.crew)) v.departAt = wait; // its first passenger starts the wait for more
  v.seats[seat] = s.id;
  if (s.crew) s.crewUntil = m.tick + ticksOf(t, between(m, t.crewSeconds));
  if (seat === 0 && v.kind === 'jet') { // #110: the pilot picks its point and takes off from the base
    v.goal = jetPoint(m, sq, v);
    takeOff(m, v);
  } else if (seat === 0) {
    Object.assign(v, { goal: -1, bias: m.points.map(() => (rnd(m) * 2 - 1) * t.tankGoalBias), parked: true, ...(v.claim < 0 && { departAt: wait }) });
    if (!air(v)) {
      Object.assign(v, { goal: drivePoint(m, sq, s, v), route: -1 });
      pickRoute(m, v);
    }
  }
  Object.assign(s, {
    vehicle: v.id, x: v.x, y: v.y, fx: v.fx, fy: v.fy, target: -1, lastTarget: -1, reviving: -1, suppression: 0, away: -1, awaySince: -1,
    dest: null, path: [], cover: null, chaseUntil: 0, role: null, regroup: false, strayUntil: 0, // a Detached rider keeps its own goal
  });
}

/**
 * A Soldier coming back from the dead (Squad Respawn or Redeploy) takes a seat if one waits for it: in the Squad Leader's
 * vehicle while the leader rides one, else in a friendly vehicle with nobody driving (fit to fight: a third of its hit points
 * or more), as its driver. True when it did. #109: never into a helicopter in the air, #110 nor a jet (its pilot walks to the slot).
 * #101: the Gunship's seats come after a jet's and a helicopter's crew (`gunshipOnReturn`).
 */
export function boardOnReturn(m: Match, sq: Squad, s: Soldier): boolean {
  if (jetOnReturn(m, sq, s) || crewOnReturn(m, sq, s) || gunshipOnReturn(m, sq, s)) return true;
  const lead = m.soldiers[sq.members[0]!]!;
  const mine = lead.state === 'alive' ? vehicleOf(m, lead.vehicle) : undefined;
  const v = mine && freeSeats(mine) > 0 && !mine.airborne ? mine : m.vehicles.find((o) => o.side === s.side && live(o) && !o.airborne && o.kind !== 'helicopter' && o.kind !== 'jet' && o.seats[0] === -1 && !crippled(m, o));
  if (!v) return false;
  mount(m, v, s, sq);
  return true;
}

/**
 * #110: a Soldier coming back (Squad Respawn or Redeploy) spawns as the pilot of its Side's empty jet, taking off from the base,
 * as BF4's deploy screen puts you in the air. Never the Squad Leader (the Squad scores, leads and comes back from them, and a
 * pilot is off at the base or in the sky), and none while a member of its Squad flies one. True when it did.
 */
function jetOnReturn(m: Match, sq: Squad, s: Soldier): boolean {
  if (s.id === sq.members[0] || membersOf(m, sq).some((o) => o !== s && vehicleOf(m, o.vehicle)?.kind === 'jet')) return false;
  const v = m.vehicles.find((o) => o.kind === 'jet' && o.side === s.side && live(o) && o.seats[0]! < 0);
  if (!v) return false;
  mount(m, v, s, sq);
  return true;
}

/**
 * #110: at match start each jet gets a pilot: the last member of one of its Side's Squads of two or more, seeded; #154 never
 * a Squad that already has one. A Side's first jet takes off at once, each next one waits at the base a seeded `jetGapSeconds`
 * after the one before.
 */
export function deployPilots(m: Match) {
  const offAt: Partial<Record<SideId, number>> = {}; // the tick the Side's previous jet takes off
  for (const v of m.vehicles) {
    if (v.kind !== 'jet') continue;
    const squads = m.squads.filter((sq) => sq.side === v.side && sq.members.length > 1 && !membersOf(m, sq).some((s) => vehicleOf(m, s.vehicle)?.kind === 'jet'));
    const sq = squads[Math.floor(rnd(m) * squads.length)];
    if (!sq) continue;
    mount(m, v, m.soldiers[sq.members.at(-1)!]!, sq);
    const previous = offAt[v.side];
    // #154 says "a seeded delay after it": after the one before, not the first, so no two later jets leave together either. The
    // gap is drawn only for a later jet, so a Side with one jet draws exactly as before
    offAt[v.side] = previous === undefined ? m.tick : previous + ticksOf(m.tune, between(m, m.tune.jetGapSeconds));
    if (previous !== undefined) Object.assign(v, { sortie: 'rearming', until: offAt[v.side], airborne: false, prey: -1, drop: false }); // the rearm's wait at the base: `sortie` takes off at `until`
  }
}

/** The first empty pilot or gun seat of `v` that none of `crew` (aboard or on their way to `v`) holds. */
const freeCrewSeat = (v: Vehicle, crew: Soldier[]) => CREW_SEATS.find((k) => v.seats[k]! < 0 && !crew.some((o) => o.crewSeat === k && (o.vehicle === v.id || o.boarding === v.id)));

/** Starts `s`'s crew stint in `seat`, Detached from its Squad's goals; `boarding` is the vehicle it is walking to, or -1. */
const startCrew = (s: Soldier, crewSeat: number, boarding: number) => Object.assign(s, { crew: true, crewSeat, boarding, detached: true, goal: -1, commitUntil: 0 });

/**
 * #129: by a seeded `crewSpawnChance`, a Soldier coming back anywhere (Squad Respawn included, not only at the HQ: BF4's deploy screen puts you into the helicopter from anywhere; never the Squad Leader, and no other member of its Squad crewing)
 * takes the first empty pilot or gun seat, not reserved by crew on their way, of a friendly helicopter on its helipad, its crew stint
 * starting now. True when it did.
 */
function crewOnReturn(m: Match, sq: Squad, s: Soldier): boolean {
  if (s.id === sq.members[0] || membersOf(m, sq).some((o) => o.crew && o.state === 'alive')) return false;
  const aboard = m.soldiers.filter((o) => o.crew && o.state === 'alive');
  for (const v of m.vehicles) {
    if (!air(v) || v.side !== s.side || !live(v) || !onPad(v) || crippled(m, v)) continue;
    const seat = freeCrewSeat(v, aboard);
    if (seat === undefined || rnd(m) >= m.tune.crewSpawnChance) continue;
    startCrew(s, seat, -1);
    mount(m, v, s, sq);
    return true;
  }
  return false;
}

/**
 * #101: a Soldier coming back takes a seat in its Side's Gunship on station: by `crewSpawnChance` its empty gun seat (as a
 * helicopter's crew: never the Squad Leader, none while a member of its Squad crews), else by `paradropChance` a free passenger
 * seat when the aircraft is nearer the Soldier's goal than where it came back (it jumps as it passes the goal: assets/gunship.ts). True when it did.
 */
function gunshipOnReturn(m: Match, sq: Squad, s: Soldier): boolean {
  const e = m.assets.effects.find((o) => o.asset === 'gunship' && o.side === s.side && o.phase === 'station');
  const v = vehicleOf(m, e?.vehicle ?? -1);
  if (!e || !v || !live(v) || crippled(m, v)) return false;
  if (v.seats[GUNSHIP_GUN]! < 0 && s.id !== sq.members[0] && !membersOf(m, sq).some((o) => o.crew && o.state === 'alive') && rnd(m) < m.tune.crewSpawnChance) {
    startCrew(s, GUNSHIP_GUN, -1);
    mount(m, v, s, sq);
    return true;
  }
  const p = m.points[goalOf(m, sq, s)];
  if (!p || !v.seats.includes(-1, GUNSHIP_GUN + 1) || dist2(v, p) >= dist2(s, p) || rnd(m) >= m.tune.paradropChance) return false;
  mount(m, v, s, sq);
  return true;
}


/**
 * Whether `v` fits a ride for `sq`'s `body` (foot leader `L`) to `p`: see `decideRide`. `fetched`: a helicopter that is fetching the
 * Squad (#131) fits from where it landed on its pickup Landing Zone, not only within `boardM`.
 */
export function fitsRide(m: Match, sq: Squad, body: Soldier[], L: Soldier, v: Vehicle, p: Vec2, fetched: boolean): boolean {
  const t = m.tune;
  const free = freeSeats(v); // #129: a pilot seat is for crew
  return (v.kind === 'jeep' || air(v)) && v.side === sq.side && live(v) && !v.airborne && !crippled(m, v) && v.job !== 'repair' && v.claim < 0 && (dist2(L, v) <= squared(t.boardM) || (fetched && v.fetch === sq.id && !!v.spot && dist2(v, v.spot) < 1)) &&
    v.seats.every((id) => id < 0 || m.soldiers[id]!.crew) && (!air(v) || v.seats[0]! >= 0 || m.soldiers.some((s) => s.crew && s.boarding === v.id)) && free >= Math.max(1, body.length - 1) &&
    (!air(v) || dist2(L, p) > squared(t.heliFitM) || sq.route >= 0);
}

/**
 * #122, at a Squad's think: with a goal farther than its `rideM` from the foot leader `L` it rides, if a vehicle fits: a
 * friendly jeep or helicopter, live, on the ground, fit to fight, unclaimed, within `boardM` of `L`, with no one aboard (#129: but
 * crew, and a helicopter needs its pilot aboard or on the way) and a free seat for every member of the body but at most one; the helicopter only for a goal beyond
 * `heliFitM` or across the river. It draws one at random, claims it for `boardWaitSeconds` and sends the body to it (after each
 * one's reaction); with one seat short the member farthest from it stays on foot, Detached on the Squad's goal.
 */
export function decideRide(m: Match, sq: Squad, body: Soldier[], L: Soldier) {
  const t = m.tune;
  const p = m.points[sq.goal];
  if (sq.task !== 'point' || !p || !body.length || dist2(L, p) <= squared(sq.rideM) || m.vehicles.some((v) => v.claim === sq.id)) return;
  const fits = m.vehicles.filter((v) => fitsRide(m, sq, body, L, v, p, true));
  if (!fits.length) return;
  const pick = Math.floor(rnd(m) * fits.length);
  const v = fits.find((o) => o.fetch === sq.id) ?? fits[pick]!; // #131: the helicopter that came for it
  const seats = freeSeats(v);
  const left = body.length > seats ? body.reduce((a, s) => (dist2(s, v) > dist2(a, v) ? s : a)) : null;
  if (left) Object.assign(left, { detached: true, goal: -1, commitUntil: m.tick + ticksOf(t, t.commitSeconds[1]) }); // walks the Squad's goal as its own Commitment
  const walk = v.fetch === sq.id ? Math.sqrt(Math.max(...body.map((s) => dist2(s, v)))) / (0.8 * t.walkSpeed) : 0; // #131: a helicopter that came lands up to `lzM` away: the wait includes the walk
  const claimUntil = m.tick + Math.round((t.boardWaitSeconds + walk) * t.hz);
  Object.assign(v, { claim: sq.id, claimUntil, departAt: claimUntil, fetch: -1 });
  for (const s of body)
    if (s !== left) Object.assign(s, { boarding: v.id, climbAt: 0, dest: null, path: [], cover: null, holdUntil: reactAt(m, s) });
}

/**
 * #129, at a Squad's think: its foot leader `L` within `boardM` of a friendly helicopter standing on its helipad with a free
 * pilot or gun seat (not counting the seats crew are already walking to), the Squad sends one member to fill it: seeded,
 * never the Squad Leader, and none if a member of the Squad already crews or walks to that helicopter. The member goes Detached
 * (and stays in the Squad), walking there as in #122.
 */
export function decideCrew(m: Match, sq: Squad, body: Soldier[], L: Soldier) {
  const t = m.tune;
  const mates = membersOf(m, sq);
  for (const v of m.vehicles) {
    if (!air(v) || v.side !== sq.side || !live(v) || !onPad(v) || crippled(m, v) || dist2(L, v) > squared(t.boardM)) continue;
    const coming = m.soldiers.filter((s) => s.crew && s.state === 'alive' && (s.vehicle === v.id || (s.vehicle < 0 && s.boarding === v.id)));
    if (CREW_SEATS.filter((k) => v.seats[k]! < 0).length <= coming.filter((s) => s.vehicle < 0).length || mates.some((s) => coming.includes(s))) continue;
    const pool = body.filter((s) => s.id !== sq.members[0] && s.boarding < 0);
    if (!pool.length) return;
    const s = pool[Math.floor(rnd(m) * pool.length)]!;
    startCrew(s, freeCrewSeat(v, coming)!, v.id); // pilot first, then the guns: the seat is theirs from here
    Object.assign(s, { climbAt: 0, dest: null, path: [], cover: null, holdUntil: reactAt(m, s) });
    return;
  }
}

/**
 * #122, one tick of a Soldier its Squad sent to a vehicle: the vehicle it is still walking to, or null when it is not boarding
 * (the claim ended or the vehicle is gone) or has just climbed in. Within `mountM` it takes a seeded `mountSeconds`, still
 * stepping in, then takes the first free seat.
 */
export function boardStep(m: Match, s: Soldier): Vehicle | null {
  const t = m.tune;
  const v = vehicleOf(m, s.boarding);
  if (!v || !live(v) || (s.crew ? v.airborne || v.seats[s.crewSeat]! >= 0 : v.claim !== s.squad || !v.seats.includes(-1))) {
    Object.assign(s, { boarding: -1, climbAt: 0, crew: false, crewSeat: -1 }); // #129: crew keep their Detached walk back to the Squad
    return null;
  }
  if (dist2(s, v) <= squared(t.mountM)) {
    if (!s.climbAt) s.climbAt = m.tick + ticksOf(t, between(m, t.mountSeconds));
    if (m.tick >= s.climbAt) {
      mount(m, v, s, m.squads[s.squad]!);
      Object.assign(s, { boarding: -1, climbAt: 0 });
      return null;
    }
  }
  return v;
}

/**
 * The Capture Point a driver takes its vehicle to: scored like its Squad's choice (the Order's bonus as ever) but by drive
 * distance from the vehicle, with its own seeded preference, stickiness to where it is going, and the crowd penalty for each
 * other friendly vehicle already going there; its Squad's goal pulls no harder than any point. A Detached driver keeps its own,
 * and #108 a transport's driver always drives to its own goal. #110: an AA's driver lays back (`aaPoint`). Exported for tests.
 */
export function drivePoint(m: Match, sq: Squad, s: Soldier, v: Vehicle): number {
  if (v.kind === 'aa') return aaPoint(m, v);
  if (v.kind !== 'tank' || (s.detached && s.goal >= 0)) return goalOf(m, sq, s);
  const t = m.tune;
  const others = (i: number) => m.vehicles.filter((o) => o !== v && o.side === v.side && live(o) && o.seats[0]! >= 0 && o.goal === i).length;
  // a tank driver thinks twice about a point where the enemy tanks its Side knows outnumber the friendly ones going, or where its Side just lost one
  const there = (i: number, o: Vec2) => dist2(o, m.points[i]!) < squared(m.points[i]!.radius + t.threatenedM);
  const foes = sideKnown(m, v.side).filter((s) => s.source === 'seen' && vehicleOf(m, s.id)?.kind === 'tank');
  const lost = m.wrecks.filter((w) => w.side === v.side && w.kind === 'tank' && m.tick - w.tick < t.routeLossSeconds * t.hz);
  const wary = (i: number) => t.tankOutgunnedPenalty * Math.max(0, foes.filter((s) => there(i, s)).length - others(i) - 1) + t.tankWreckPenalty * lost.filter((w) => there(i, w)).length;
  const bias = v.bias.map((b, i) => b + (i === v.goal ? t.stickiness : 0) - t.crowdPenalty * others(i) - (sq.task === 'point' && sq.goal === i ? t.stickiness : 0) - wary(i));
  return bestPoint(m, sq, v, 0, { flow: (i) => driveFlow(m, v.side, i), bias });
}

/** #154: what another friendly AA laying back on a flank takes off each point on that flank, in the metres `aaPoint` scores in: more than the gap between Auental's two rear flags with both preferences against it. */
const AA_SPREAD_M = 300;

/**
 * #110: the Capture Point an AA's driver lays back on: its Side's own, never a keystone one (#150), the nearer its HQ and the farther out
 * on a flank (off the line between the HQs) the better, with the driver's seeded preference; #154 less on a flank another
 * friendly AA is heading for, so two spread over both. -1 with none (it holds where it is, at first in the HQ park).
 */
function aaPoint(m: Match, v: Vehicle): number {
  const own = m.map.hqs[v.side];
  const foe = m.map.hqs[enemyOf(v.side)];
  const [ax, ay] = [foe.x - own.x, foe.y - own.y];
  const len = Math.sqrt(ax * ax + ay * ay) || 1;
  const off = (p: Vec2) => ((p.x - own.x) * ay - (p.y - own.y) * ax) / len; // out on a flank, signed by which one
  const keys = keystone(m);
  // #154 counts another AA against its flag; it counts here against the flag's whole flank, since on Auental F scores as well as
  // B and a count per flag would send both AAs south
  const flanksTaken = m.vehicles.filter((o) => o !== v && o.kind === 'aa' && o.side === v.side && live(o) && o.seats[0]! >= 0 && o.goal >= 0).map((o) => off(m.points[o.goal]!));
  let best = -1;
  let top = -Infinity;
  m.points.forEach((p, i) => {
    if (p.owner !== v.side || keys.includes(p)) return;
    const flank = off(p);
    const penalty = AA_SPREAD_M * flanksTaken.filter((f) => f * flank > 0).length;
    const score = Math.abs(flank) - Math.sqrt(dist2(p, own)) / 2 + (v.bias[i] ?? 0) * 100 - penalty; // ponytail: a metre out on a flank counts as two back toward the HQ, the preference in hundreds of metres; tune keys if the AA needs placing finer
    if (score > top) [best, top] = [i, score];
  });
  return best;
}

/**
 * At its Squad's think, a Soldier aboard: the driver keeps the vehicle on its own Capture Point (the Squad's, or its own
 * when it boarded Detached; Retreat and Resupply ignore it). One who wants out (`wantsOut`) gets out once the vehicle has stood
 * `dismountStopSeconds`, stopping it for that first; Detached when away from the Squad. #110: a jet's pilot picks the point of its
 * next pass, and never gets out.
 */
export function ride(m: Match, sq: Squad, s: Soldier) {
  const t = m.tune;
  const v = vehicleOf(m, s.vehicle)!;
  if (v.kind === 'jet') {
    v.goal = jetPoint(m, sq, v);
    return;
  }
  if (v.seats[0] === s.id && air(v)) {
    decideJob(m, v); // #131
    if (s.vehicle < 0) return; // the pilot bailed out
  }
  if (v.seats[0] === s.id && !air(v)) {
    const goal = drivePoint(m, sq, s, v);
    if (goal >= 0 || v.kind === 'aa') {
      if (goal !== v.goal) v.route = -1; // a new goal, a new way there
      v.goal = goal; // #110: an AA with no rear point left stops where it is
      pickRoute(m, v);
    }
  }
  if (!wantsOut(m, sq, s, v)) return;
  if (v.airborne) return jump(m, s);
  if (m.tick - v.movedAt < Math.round(t.dismountStopSeconds * t.hz)) {
    if (v.halt < 0) v.halt = m.tick; // nobody bails at speed
    return;
  }
  getOut(m, s, v);
}

/** Out of its seat on foot; Detached when away from the Squad. */
export function getOut(m: Match, s: Soldier, v: Vehicle) {
  v.seats[v.seats.indexOf(s.id)] = -1;
  Object.assign(s, { vehicle: -1, exited: v.id });
  const foot = membersOf(m, m.squads[s.squad]!).filter((o) => o.state === 'alive' && o.vehicle < 0 && o !== s && !o.detached);
  s.detached = s.crew || (foot.length > 0 && dist2(s, footLeader(foot)!) > squared(m.tune.detachM)); // #129: crew walk back, Detached until they rejoin
  if (s.crew) Object.assign(s, { crew: false, crewUntil: -1, crewSeat: -1, goal: -1 });
}

/**
 * #130: the one way to make a rider leave an airborne helicopter: it parachutes down, taking `chuteSeconds`, to a spot seeded
 * up to `chuteScatterM` from where it jumped (the nearest standable one if that is not ground), then is a Soldier on foot.
 */
export function jump(m: Match, s: Soldier) {
  const t = m.tune;
  const r = t.chuteScatterM;
  let dx = (rnd(m) * 2 - 1) * r;
  let dy = (rnd(m) * 2 - 1) * r;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > r) [dx, dy] = [(dx * r) / d, (dy * r) / d];
  let to = { x: s.x + dx, y: s.y + dy };
  if (!canStand(m, s, to)) to = nearestWalkable(m, to);
  getOut(m, s, vehicleOf(m, s.vehicle)!);
  s.chute = { t0: m.tick, t1: m.tick + ticksOf(t, t.chuteSeconds), x0: s.x, y0: s.y, x1: to.x, y1: to.y };
}

/** #101: everyone aboard `v` jumps. */
export const bail = (m: Match, v: Vehicle) => riders(m, v).forEach((s) => jump(m, s));

/** #130: parachutists come down: along the line to the landing spot, then on foot. */
function descend(m: Match) {
  for (const s of m.soldiers) {
    const c = s.chute;
    if (!c) continue;
    const f = Math.min(1, (m.tick - c.t0) / (c.t1 - c.t0));
    Object.assign(s, { x: c.x0 + (c.x1 - c.x0) * f, y: c.y0 + (c.y1 - c.y0) * f });
    if (f === 1) s.chute = null;
  }
}

/**
 * The shared leaving rule (#27, #108), at think. Anyone gets out under a third of the hit points; a tank's (#110 an AA's) crew only then.
 * A transport empties at its goal. A passenger also gets out once the vehicle has stood still `stillSeconds` (waiting to set
 * off is not standing still), within `dismountM` of its own Capture Point, or once its drive distance to that point has grown
 * for `awaySeconds`. #109: nobody gets out of a helicopter in the air, #129 crew only once their stint is over on its helipad, and its passengers never go by
 * drive distance (it flies straight to their majority's goal).
 */
function wantsOut(m: Match, sq: Squad, s: Soldier, v: Vehicle): boolean {
  const t = m.tune;
  if (v.kind === 'gunship') return false; // #101: its Asset puts each one out (assets/gunship.ts)
  if (air(v)) {
    if (v.job === 'repair' && !s.crew) return true; // #131: its passengers leave it (in the air by parachute, `decideJob`), its crew stay at their seats
  } else if (crippled(m, v)) return true;
  if (air(v) && v.airborne) return false;
  if (s.crew) return m.tick >= s.crewUntil && onPad(v) && v.claim < 0 && riders(m, v).every((o) => o.crew); // #129: its stint over, on the helipad, no claimed Squad boarding and no passenger aboard (never a pilotless helicopter with riders)
  if (v.kind === 'tank' || v.kind === 'aa') return false;
  if (v.goal >= 0 && (air(v) ? !!v.lz && dist2(v, v.lz) < 1 : flowDist(m, driveFlow(m, v.side, v.goal), v) === 0)) return true;
  if (v.seats[0] === s.id) return false;
  if (m.tick - Math.max(v.movedAt, v.departAt) >= t.stillSeconds * t.hz) return true;
  const own = goalOf(m, sq, s);
  const p = m.points[own];
  if (!p) return false;
  if (dist2(v, p) <= squared(t.dismountM)) return true;
  if (air(v)) return false;
  const d = flowDist(m, driveFlow(m, v.side, own), v);
  if (d === Infinity) return false;
  if (s.away >= 0 && d > s.away) s.awaySince = s.awaySince < 0 ? m.tick : s.awaySince;
  else if (d < s.away) s.awaySince = -1;
  s.away = d;
  return s.awaySince >= 0 && m.tick - s.awaySince >= t.awaySeconds * t.hz;
}

/**
 * The vehicle phase, after the Soldiers walk: fresh vehicles in empty slots `vehicleRespawnSeconds` after the last one died
 * (#108: a point's for its owner, at once when the point first has one or has changed hands; #154 so does a live one with
 * nobody aboard standing in its slot, so a captured point never keeps the enemy's parked vehicle), then every one with a driver
 * drives (#109: or flies, #110 a jet its sortie) unless it stands for a dismount (long enough for everyone who wants out to have thought once); its
 * riders ride along.
 */
export function drive(m: Match) {
  const t = m.tune;
  descend(m); // #130
  for (const v of m.vehicles) {
    const side = v.point < 0 ? v.side : m.points[v.point]!.owner;
    if (!live(v)) {
      if (flown(v)) continue; // #101 #139: only its Asset's next call brings it back
      if (side && (v.deadAt === DORMANT || side !== v.side || m.tick - v.deadAt >= t.vehicleRespawnSeconds * t.hz)) Object.assign(v, fresh(m, side, v.kind, v.slot));
      continue;
    }
    if (side && side !== v.side && v.seats.every((id) => id < 0) && dist2(v, v.slot) < 1) Object.assign(v, fresh(m, side, v.kind, v.slot));
    if (v.claim >= 0) {
      const walking = m.soldiers.filter((s) => s.boarding === v.id && !s.crew && s.state === 'alive' && s.vehicle < 0);
      if (!walking.length || m.tick >= v.claimUntil) { // everyone is in, or the wait is out: it leaves with whoever is aboard
        for (const s of walking) Object.assign(s, { boarding: -1, climbAt: 0 });
        Object.assign(v, { claim: -1, departAt: m.tick });
      }
    }
    if (v.halt >= 0 && v.speed > 0) v.halt = m.tick; // the stop counts from when it has come to a stop
    const halted = v.halt >= 0 && m.tick - v.halt < Math.round((t.dismountStopSeconds + t.thinkIntervalSeconds[1] * (1 + t.thinkJitter)) * t.hz);
    if (!halted) v.halt = -1;
    const full = !v.seats.includes(-1);
    if (v.kind === 'jet') {
      if (v.seats[0]! >= 0) sortie(m, v); // #110
    } else if (flown(v)) {
      // #101 #139: its Asset flies it
    } else if (air(v)) {
      if (v.job === 'bail') glide(m, v);
      else if (!halted && v.seats[0]! >= 0) fly(m, v);
      repairOnPad(m, v);
    } else if (v.seats[0]! >= 0 && v.goal >= 0 && (full || m.tick >= v.departAt)) step(m, v, halted);
    else v.speed = 0; // no driver, or waiting to set off
    v.seats.forEach((id, k) => {
      const s = m.soldiers[id];
      const out = air(v) ? beam(v, k) : null; // #129: a gun seat's Soldier sits out to its side
      if (s) Object.assign(s, { x: v.x + (out ? out.x * GUN_OUT_M : 0), y: v.y + (out ? out.y * GUN_OUT_M : 0), fx: v.fx, fy: v.fy, ammo: t.ammo, suppression: 0 }); // no ammo worries
    });
  }
}

/**
 * #123: one tick along the drive flow field. The hull steers toward the way ahead by at most its class's turn rate, easing
 * into a small correction (`STEER_EASE`), and its speed moves toward the speed it wants by at most its acceleration (braking
 * `brakeMul` times that). The way ahead is the middle of a few cells down the flow field when a straight line to it stays on
 * open ground no worse than the hull's own (so it neither clips a corner nor cuts a bend off the road), else nearer, else the
 * next cell. It wants the road or open speed of the ground under it, less the sharper the turn ahead, no more than lets it
 * stop at the end of the flow field (`halt`: none at all, for a dismount), and no more than stops short of blocked ground
 * dead ahead. A turn it could not stop out of it does not make yet: it brakes straight on, and turns once slow enough. A step
 * that would still end on blocked ground is not taken: it stops there and keeps turning. Parked once there.
 */
function step(m: Match, v: Vehicle, halt: boolean) {
  const t = m.tune;
  const g = m.drive[v.side];
  overCrossing(m, v);
  const f = routeFlow(m, v);
  const left = flowDist(m, driveFlow(m, v.side, v.goal), v); // by the road's field whatever the route: they end on the same cells
  v.parked = left === 0;
  const k = cellIndex(m, v.x, v.y);
  const cost = (k >= 0 && g.cost[k]) || 20;
  const tank = v.kind !== 'jeep'; // #110: an AA handles as a tank
  const accel = tank ? t.tankAccel : t.jeepAccel;
  const { roadMps, openMps } = specOf(t, v.kind);
  const open = (x: number, y: number) => {
    const c = cellIndex(m, x, y);
    return c >= 0 && g.cost[c]! > 0;
  };
  const clear = (ux: number, uy: number, most: number, dearest?: number) => openRun(m, g, v, ux, uy, most, dearest);
  const seen = (p: Vec2, dearest?: number) => {
    const d = Math.sqrt(dist2(v, p));
    return d < 0.01 || clear((p.x - v.x) / d, (p.y - v.y) / d, d, dearest) >= d;
  };
  /** The way ahead: the middle of the `span` flow cells from `n` on, so it does not hop as the hull crosses a cell. */
  const aim = (n: number, span: number): Vec2 | null => {
    let [x, y] = [0, 0];
    for (let i = 0; i < span; i++) {
      const p = alongPath(m, v, n + i, (q) => seen(q)) ?? flowLook(m, f, v, n + i, g);
      if (!p) return null;
      [x, y] = [x + p.x / span, y + p.y / span];
    }
    return { x, y };
  };
  /** The tick heading (fx, fy) and wanting speed `want`: no faster than stops short of blocked ground dead ahead. `safe`: it lands on open ground and can still stop before any. */
  const move = (fx: number, fy: number, want: number) => {
    const room = clear(fx, fy, (v.speed * v.speed) / (accel * t.brakeMul * BRAKE_RESERVE) + t.cellM);
    const speed = approach(v.speed, Math.min(want, stopSpeed(Math.max(0, room - t.cellM / 2), accel, t.brakeMul, BRAKE_RESERVE) + accel / t.hz), accel, t.brakeMul, t.hz);
    const [x, y] = [v.x + (fx * speed) / t.hz, v.y + (fy * speed) / t.hz];
    const lands = speed === 0 || open(x, y);
    return { speed, fx, fy, x, y, lands, safe: lands && speed * speed <= 2 * accel * t.brakeMul * room };
  };
  /** The tick if the way ahead is `n` flow cells on (past the next cell, only with a clear straight line to it): where the hull points, how fast it goes, where that lands. */
  const attempt = (n: number, span = 1) => {
    const to = aim(n, span);
    const d = to ? Math.sqrt(dist2(v, to)) : 0;
    if (!to || d < 0.01) return move(v.fx, v.fy, 0);
    const way = { x: (to.x - v.x) / d, y: (to.y - v.y) / d };
    if (n > 1 && !seen(to, cost)) return null; // nor over worse ground than it is on: it keeps to the road round a bend
    const dot = v.fx * way.x + v.fy * way.y;
    const soft = dot > 0 && dot < cosDeg(1) ? { x: v.fx + (way.x - v.fx) * STEER_EASE, y: v.fy + (way.y - v.fy) * STEER_EASE } : way; // eased: a correction is steered in over a few ticks, not snapped to (within a degree it is, or it would never quite get there)
    const n2 = Math.sqrt(soft.x * soft.x + soft.y * soft.y);
    const { fx, fy } = turnToward(v.fx, v.fy, soft.x / n2, soft.y / n2, tank ? t.tankTurnDegPerS : t.jeepTurnDegPerS, t.hz);
    if (halt || v.parked) return move(fx, fy, 0);
    const align = Math.max(0, fx * way.x + fy * way.y); // 1 straight on, 0 at a right angle or worse
    const base = cost === 10 ? roadMps : (openMps * 20) / cost;
    return move(fx, fy, Math.min(base * (t.turnSpeedMin + (1 - t.turnSpeedMin) * align), stopSpeed(left, accel, t.brakeMul)));
  };
  const far = attempt(3, AIM_SPAN);
  const mid = far?.safe ? far : attempt(2, 2);
  const near = mid?.safe ? mid : attempt(1)!;
  const on = near.safe ? near : move(v.fx, v.fy, 0); // it cannot turn that way yet: straight on, braking
  const a = near.safe ? near : on.safe && on.speed > 0 ? on : near; // stopped, it turns where it stands
  if (!a.lands) v.path = []; // a detour it can't follow: back to its route
  v.speed = a.lands ? a.speed : 0;
  Object.assign(v, { fx: a.fx, fy: a.fy });
  if (v.speed > 0) Object.assign(v, { x: a.x, y: a.y, movedAt: m.tick });
}

/** How many flow cells the far way ahead is averaged over. */
const AIM_SPAN = 4;
/** The share of the turn still to make that a driver steers in each tick (the class's turn rate caps it). ponytail: per tick, so it rides on `hz`; scale it if the tick rate ever changes. */
const STEER_EASE = 0.15;

/** #109: the passengers' majority goal (the pilot's breaks a tie), -1 = none aboard with a Capture Point: home. */
function ferryGoal(m: Match, v: Vehicle): number {
  const goals = v.seats.map((id) => {
    const s = m.soldiers[id];
    return s && (!s.crew || s.id === v.seats[0]) ? goalOf(m, m.squads[s.squad]!, s) : -1; // #129: the guns' crew do not vote
  });
  const votes = goals.slice(1).filter((g) => g >= 0);
  const count = (g: number) => votes.filter((o) => o === g).length;
  return votes.reduce((a, g) => (count(g) > count(a) || (count(g) === count(a) && g === goals[0]) ? g : a), votes[0] ?? -1);
}

/** `p` pushed out of the enemy HQ circle (a helicopter never enters it); `margin` metres past the rim. */
export function clearOfHq(m: Match, side: SideId, p: Vec2, margin = 0): Vec2 {
  const hq = m.map.hqs[enemyOf(side)];
  const r = (hq.radius ?? m.tune.hqRadius) + margin;
  const e2 = dist2(p, hq);
  return e2 < r * r ? { x: hq.x + ((p.x - hq.x) * r) / Math.sqrt(e2), y: hq.y + ((p.y - hq.y) * r) / Math.sqrt(e2) } : p; // ponytail: slides round the rim; stalls only on a line through its exact centre
}

/** #131: where a helicopter is bound for: the pickup Landing Zone it is fetching to, the point it supports, else its passengers' Landing Zone, else home. */
const bound = (v: Vehicle): Vec2 => ((v.job === 'ferry' && v.fetch >= 0) || v.job === 'support' ? v.spot : null) ?? (v.goal >= 0 && v.lz ? v.lz : v.slot);

/**
 * #124, as it lifts off: the trip. Going out, a Landing Zone for the passengers' goal (`landingZone`: away from the enemies its
 * riders' Squads know); out or home, a dogleg waypoint (`dogleg`) that keeps off enemy-held points and known enemies. #131: with a
 * known enemy within `lzThreatM` of the goal (any friendly Squad's) it is a hot goal: its riders jump over the Landing Zone, after circling the point first if a gunner is aboard.
 */
export function plan(m: Match, v: Vehicle) {
  const known = sideKnown(m, v.side); // #133: any friendly Squad's eyes
  const threats = [...m.points.filter((p) => p.owner === enemyOf(v.side)).map((p) => ({ x: p.x, y: p.y, r: p.radius })), ...known.map((e) => ({ x: e.x, y: e.y, r: 0 }))];
  if (v.goal >= 0) {
    const p = m.points[v.goal]!;
    v.lz = landingZone(m, p, known, (q) => clearOfHq(m, v.side, q, 1));
    const hot = sideKnown(m, v.side).some((e) => e.source !== 'marked' && dist2(e, p) <= squared(m.tune.lzThreatM)); // #131: any friendly Squad's eyes; #136: not a Mark, a guess is no reason to jump (it still turns the Landing Zone away)
    const circles = hot && (v.seats[1]! >= 0 || v.seats[2]! >= 0); // with no gunner, circling is pointless (#128): the riders still jump
    Object.assign(v, { spot: circles ? { x: p.x, y: p.y } : null, drop: hot, until: -1, ...(circles && { spin: spinFor(m, v) }) });
  }
  v.wp = dogleg(m, v, bound(v), threats);
}

/**
 * #109, one tick of a piloted helicopter: it takes its passengers to their goal's Landing Zone (#124), empty it goes home to its
 * slot, and sets down there. On the ground it lifts off only `unloadSeconds` after it landed, with free seats not before its first
 * passenger's wait is over, and spools its rotor `spoolSeconds` first (`plan` draws the trip as it lifts); it never stays at a goal
 * its passengers are leaving. A new goal ends the trip's Landing Zone: in the air it plans afresh, on the ground at lift-off (a
 * Landing Zone kept from the last trip would hold it down and empty every Squad that climbs in). #131: its job sends it elsewhere
 * (`bound`): a pickup it waits at for the Squad it came for, or a point to circle. Airborne, see `cruise`.
 */
function fly(m: Match, v: Vehicle) {
  const t = m.tune;
  const goal = ferryGoal(m, v);
  if (goal !== v.goal) {
    v.goal = goal;
    if (goal >= 0) v.lz = null; // emptied (-1), it keeps the last one: its passengers got out there
    if (v.airborne && v.flareUntil < 0) plan(m, v);
  }
  if (v.airborne) return cruise(m, v);
  const there = v.spot && bound(v) === v.spot ? dist2(v, v.spot) < 1 : v.goal >= 0 ? !!v.lz && dist2(v, v.lz) < 1 : dist2(v, v.slot) < 1e-4;
  const held = (v.landedAt >= 0 && m.tick - v.landedAt < Math.round(t.unloadSeconds * t.hz)) || (v.seats.includes(-1) && m.tick < v.departAt);
  if (there || held) return void (v.spoolUntil = -1);
  if (v.spoolUntil < 0) v.spoolUntil = m.tick + Math.round(t.spoolSeconds * t.hz);
  if (m.tick < v.spoolUntil) return;
  v.spoolUntil = -1;
  plan(m, v);
  Object.assign(v, { airborne: true, parked: false });
}

/**
 * #124, one tick in the air: heading toward the waypoint, then the destination (`bound`), by at
 * most `heliTurnDegPerS`; speed toward `heliMps` (less the sharper the turn ahead) and no more than lets it stop on the
 * destination, by `heliAccel` either way (the stop curve plans on `BRAKE_RESERVE` of it, see `stopSpeed`). It banks through the waypoint
 * within a second's flight of it. On arrival it hovers `flareSeconds`, still airborne, then touches down. Never into the enemy HQ circle.
 * #131: past its waypoint, Support circles its point, and a hot goal's helicopter circles it for `orbitSeconds` once within a quarter of
 * `orbitM` past its circle (`circle`); after the hover over a hot goal's Landing Zone the riders jump instead of it landing.
 */
function cruise(m: Match, v: Vehicle) {
  const t = m.tune;
  if (v.flareUntil >= 0) {
    v.speed = approach(v.speed, 0, t.heliAccel, 1, t.hz); // the last of the braking
    if (m.tick < v.flareUntil) return;
    if (!v.drop) return void Object.assign(v, { airborne: false, parked: true, landedAt: m.tick, flareUntil: -1 });
    for (const s of riders(m, v)) if (!s.crew) jump(m, s); // over the Landing Zone
    Object.assign(v, { flareUntil: -1, drop: false, spot: null });
    return;
  }
  if (v.drop && v.spot && !v.wp && v.until >= 0 && m.tick >= v.until) v.spot = null; // the orbit is over
  if (v.spot && !v.wp && (v.job === 'support' || (v.drop && (v.until >= 0 || dist2(v, v.spot) <= squared(1.25 * t.orbitM))))) {
    if (v.drop && v.until < 0) v.until = m.tick + ticksOf(t, t.orbitSeconds);
    return circle(m, v, v.spot);
  }
  const to = bound(v);
  let aim = v.wp ?? to;
  let d = Math.sqrt(dist2(v, aim));
  if (v.wp && d <= Math.max(2, v.speed)) {
    v.wp = null;
    aim = to;
    d = Math.sqrt(dist2(v, aim));
  }
  const left = d + (v.wp ? Math.sqrt(dist2(v.wp, to)) : 0);
  let { fx, fy } = v;
  let want = 0;
  if (d >= 0.01) {
    const way = { x: (aim.x - v.x) / d, y: (aim.y - v.y) / d };
    ({ fx, fy } = turnToward(fx, fy, way.x, way.y, t.heliTurnDegPerS, t.hz));
    const align = Math.max(0, fx * way.x + fy * way.y);
    want = Math.min(t.heliMps * (t.turnSpeedMin + (1 - t.turnSpeedMin) * align), stopSpeed(left, t.heliAccel, 1, BRAKE_RESERVE));
  }
  const speed = approach(v.speed, want, t.heliAccel, 1, t.hz); // braking no harder than speeding up
  const arrived = !v.wp && (d < 0.01 || speed / t.hz >= d);
  const at = arrived ? aim : clearOfHq(m, v.side, { x: v.x + (fx * speed) / t.hz, y: v.y + (fy * speed) / t.hz });
  Object.assign(v, { x: at.x, y: at.y, fx, fy, speed, movedAt: m.tick, ...(arrived && { flareUntil: m.tick + ticksOf(t, t.flareSeconds) }) });
}

/**
 * Perception, for each vehicle with anyone aboard: one pair of eyes from the hull (the Soldier cone and line of sight at `vehicleVisionMul`
 * x `visionM`) on enemy Soldiers on foot and enemy vehicles; what it sees goes into the memory of every Squad with a rider aboard. A tank's
 * main gun takes an enemy tank first, then any other vehicle, then infantry, nearest within each, in range; the coax (#108: or a jeep's MG)
 * the nearest infantry in its range. #109: a helicopter's eyes see a full circle out to `airVisionM`, over walls (its door gun
 * fires as the MG); anyone's eyes see an airborne vehicle over walls. #110: a jet sees nothing, and only an AA sees one: the AA sees
 * a helicopter, or a jet over the Play Area, a full circle out to `aaRangeM` over walls, and lays its gun on a jet first, else
 * the nearest helicopter, else (#139) the nearest drone or Recon Plane, else the nearest jeep within `aaGroundRangeM` (its infantry target is its coax's); never on a tank.
 * #101: the Gunship is seen and fired on as a helicopter, over the Play Area only as a jet; its own riders look at nothing
 * (its Asset says what it sees, and its gunner's side gun picks its own target, as a helicopter's).
 */
export function look(m: Match, v: Vehicle) {
  const t = m.tune;
  v.target = -1;
  v.coax = -1;
  const aboard = riders(m, v);
  if (!live(v) || !aboard.length || high(v)) return;
  const squads = [...new Set(aboard.map((s) => m.squads[s.squad]!))];
  const R = air(v) ? t.airVisionM : t.visionM * t.vehicleVisionMul;
  const sees = (e: Vec2 & { side: SideId; airborne?: boolean; chute?: object | null }) => {
    const d2 = dist2(v, e);
    const cone = air(v) || (e.x - v.x) * v.fx + (e.y - v.y) * v.fy >= t.visionCos * Math.sqrt(d2);
    return d2 <= R * R && cone && !inHq(m, e.side, e) && (air(v) || !!e.airborne || !!e.chute || los(m, v, e));
  };
  const aaSees = (u: Vehicle) => dist2(v, u) <= squared(t.aaRangeM) && !inHq(m, u.side, u) && (!high(u) || insidePolygon(m.map.playArea, u.x, u.y));
  const range = v.kind === 'tank' ? t.tankRangeM : v.kind === 'aa' ? t.aaRangeM : 0;
  let best: { id: number; rank: number; d2: number } | null = null;
  const consider = (id: number, rank: number, d2: number) => {
    if (d2 <= squared(range) && (!best || rank < best.rank || (rank === best.rank && d2 < best.d2))) best = { id, rank, d2 };
  };
  let coaxD2 = squared(specOf(t, v.kind).gunM);
  for (const e of m.soldiers) {
    if (e.side === v.side || e.state !== 'alive' || e.vehicle >= 0 || !sees(e)) continue;
    if (!m.sightings[v.side].some((o) => o.id === e.id && o.tick >= m.tick - 1)) e.uavUntil = -1; // #75, as for a Soldier's eyes
    for (const sq of squads) see(m, sq, e);
    const d2 = dist2(v, e);
    if (v.kind === 'tank') consider(e.id, 2, d2);
    if (d2 <= coaxD2) [v.coax, coaxD2] = [e.id, d2];
  }
  for (const u of m.vehicles) {
    const aa = v.kind === 'aa' && flies(u);
    if (u.side === v.side || !live(u) || (high(u) && !aa) || !(aa ? aaSees(u) : sees(u))) continue;
    for (const sq of squads) see(m, sq, u);
    const d2 = dist2(v, u);
    if (v.kind === 'tank') consider(u.id, u.kind === 'tank' ? 0 : 1, d2);
    else if (aa) consider(u.id, u.kind === 'jet' ? 0 : unmanned(u) ? 2 : 1, d2); // #139: a jet, then a helicopter (the Gunship is fired on as one), then a drone or the Recon Plane
    else if (v.kind === 'aa' && u.kind === 'jeep' && d2 <= squared(t.aaGroundRangeM)) consider(u.id, 3, d2);
  }
  if (best || v.coax >= 0) for (const sq of squads) sq.lastSeen = m.tick;
  v.target = (best as { id: number } | null)?.id ?? -1;
}

/**
 * #129: the nearest enemy on foot a helicopter's gun in `seat` (1 left, 2 right) can fire at: within the gun's range and its
 * `gunArcDeg` arc centred on its beam (a dot product against the beam, no trig), outside its HQ. Null for any other seat.
 */
export function sideGun(m: Match, v: Vehicle, seat: number): Soldier | null {
  const t = m.tune;
  const out = beam(v, seat);
  if (!out) return null;
  const cos = cosDeg(t.gunArcDeg / 2);
  let best: Soldier | null = null;
  let bestD2 = squared(specOf(t, v.kind).gunM);
  for (const e of m.soldiers) {
    if (e.side === v.side || e.state !== 'alive' || e.vehicle >= 0 || inHq(m, e.side, e)) continue;
    const d2 = dist2(v, e);
    if (d2 <= bestD2 && (e.x - v.x) * out.x + (e.y - v.y) * out.y >= cos * Math.sqrt(d2)) [best, bestD2] = [e, d2];
  }
  return best;
}

/**
 * A Soldier on foot sees an enemy vehicle at `vehicleVisionMul` x its range, in its cone and line of sight, outside its HQ.
 * #108: the nearest jeep (#109: or helicopter) it sees closer than `withinD2` (metres squared), a rifle target, or null.
 * #109: an airborne one over walls. #110: never a jet (only an AA sees one; #101 nor the Gunship); an AA is seen, but no rifle target.
 */
export function seeVehicles(m: Match, s: Soldier, sq: Squad, withinD2: number): Vehicle | null {
  const t = m.tune;
  const R = t.visionM * t.vehicleVisionMul;
  let jeep: Vehicle | null = null;
  for (const v of m.vehicles) {
    if (v.side === s.side || !live(v) || high(v)) continue;
    const d2 = dist2(s, v);
    if (d2 > R * R || (v.x - s.x) * s.fx + (v.y - s.y) * s.fy < t.visionCos * Math.sqrt(d2) || inHq(m, v.side, v) || (!v.airborne && !los(m, s, v))) continue;
    see(m, sq, v);
    if ((v.kind === 'jeep' || air(v)) && d2 < withinD2) [jeep, withinD2] = [v, d2];
  }
  return jeep;
}

/** What `v`'s main gun is laid on: a Soldier or a vehicle, or undefined. */
export const targetOf = (m: Match, v: Vehicle): Vec2 | undefined => m.soldiers[v.target] ?? vehicleOf(m, v.target);

/**
 * The combat phase: each driver whose main gun is due fires at its target in range, a round that flies to the target's spot
 * at `tankShellMps`; then every round due lands, a Strike-shaped impact hitting the enemy's vehicles in its kill radius:
 * `tankVsVehicleDamage` on a tank (#110 or an AA), anything lighter destroyed. No Commander is paid for what it kills. #110: a
 * jet's bombs land the same way, each a blast of its own (`jetBomb*`), friend or foe as a Strike's, never on the air.
 */
export function mainGuns(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const v of m.vehicles) {
    if (v.kind !== 'tank') continue;
    const e = targetOf(m, v);
    if (e && v.target !== v.laid) { // laying the gun on a new target takes a seeded moment, so two tanks never trade the first round together
      v.laid = v.target;
      v.nextFire = Math.max(v.nextFire, m.tick + Math.round((t.tankAimSeconds[0] + rnd(m) * (t.tankAimSeconds[1] - t.tankAimSeconds[0])) * t.hz));
    }
    if (!live(v) || v.seats[0]! < 0 || !e || m.tick < v.nextFire || dist2(v, e) > t.tankRangeM * t.tankRangeM || inHq(m, v.side, v)) continue; // nor out of its own HQ (combat.ts fire)
    v.nextFire = m.tick + Math.round(t.tankFireSeconds * t.hz);
    const flight = Math.max(1, Math.round((Math.sqrt(dist2(v, e)) / t.tankShellMps) * t.hz));
    v.rounds.push({ x0: v.x, y0: v.y, x: e.x, y: e.y, launch: m.tick, land: m.tick + flight });
  }
  for (const v of m.vehicles)
    for (const r of v.rounds.filter((r) => r.land <= m.tick)) {
      events.push({ kind: 'impact', side: v.side, x: r.x, y: r.y, asset: r.bomb ? 'bomb' : 'tank', from: v.id });
      if (r.bomb) blast(m, v.side, r, { killM: t.jetBombKillM, woundM: t.jetBombWoundM, suppressM: t.jetBombSuppressM, suppression: 1 }, null, events, { damage: (u) => (u.airborne ? 0 : t.jetBombVehicleDamage) });
      else blast(m, v.side, r, { killM: t.tankKillM, woundM: t.tankWoundM, suppressM: t.tankSuppressM, suppression: t.tankSuppression }, null, events, { damage: (u) => (u.kind === 'tank' || u.kind === 'aa' ? t.tankVsVehicleDamage : Infinity), foesOnly: true });
      v.rounds.splice(v.rounds.indexOf(r), 1);
    }
}

/** A Launcher is roster member 1 of its Squad. */
export const isLauncher = (m: Match, s: Soldier) => m.squads[s.squad]!.members[1] === s.id;

/** The nearest enemy vehicle a Launcher may fire a rocket at: live, within `rocketRangeM`, in line of sight (#109: or airborne), outside its HQ; #110 never a jet, #101 nor the Gunship. */
export function rocketTarget(m: Match, s: Soldier): Vehicle | null {
  let best: Vehicle | null = null;
  let bestD2 = squared(m.tune.rocketRangeM);
  for (const v of m.vehicles) {
    const d2 = dist2(s, v);
    if (v.side === s.side || !live(v) || high(v) || d2 > bestD2 || inHq(m, v.side, v) || (!v.airborne && !los(m, s, v))) continue;
    [best, bestD2] = [v, d2];
  }
  return best;
}

/**
 * `damage` to `v` from Side `by`; at 0 hit points it is destroyed: every occupant dies outright (a Ticket each), and a Strike
 * (`cause`) of the enemy's scores them for that Commander at the shell tariff; it leaves a Wreck where it died (#109: a helicopter
 * falls in place), seen by the enemy only if they saw it in the last perception phase (#119: in the air too). #101: everyone
 * aboard the Gunship bails out instead, and both Sides see it fall (the sky rule).
 */
export function hurt(m: Match, v: Vehicle, damage: number, by: SideId, cause: Soldier['cause'], events: SimEvent[]) {
  if (!live(v)) return;
  v.hp -= damage;
  if (v.hp > 0) return;
  if (v.kind === 'gunship') bail(m, v);
  for (const s of riders(m, v)) {
    if (cause && by !== s.side) s.cause = cause;
    die(m, s, events);
  }
  wreck(m, v);
}

/** `v` is destroyed where it is: a Wreck, seen by the enemy only if they saw it in the last perception phase (#119: in the air too). #139: a drone or the Recon Plane leaves none (too small to block a road or to mark the map). */
export function wreck(m: Match, v: Vehicle) {
  if (unmanned(v)) return void Object.assign(v, { hp: 0, deadAt: m.tick, airborne: false });
  const seen = v.kind === 'gunship' || m.sightings[enemyOf(v.side)].some((o) => o.id === v.id && o.tick >= m.tick - 1);
  m.wrecks.push({ side: v.side, kind: v.kind, x: v.x, y: v.y, fx: v.fx, fy: v.fy, seen, tick: m.tick });
  Object.assign(v, { hp: 0, deadAt: m.tick, target: -1, coax: -1, airborne: false });
}

/** A Soldier leaves its seat (it died, or came back from the dead). */
export function leave(m: Match, s: Soldier) {
  s.chute = null; // #130: dead or brought back mid-descent
  const v = vehicleOf(m, s.vehicle);
  if (v) v.seats[v.seats.indexOf(s.id)] = -1;
  Object.assign(s, { vehicle: -1, crew: false, crewUntil: -1, crewSeat: -1 });
}

export function vehicleViews(m: Match, side: SideId, seen: Set<number>): VehicleView[] {
  const turret = (v: Vehicle) => {
    const e = targetOf(m, v);
    const d = e ? Math.sqrt(dist2(v, e)) : 0;
    return d > 0 ? { tx: (e!.x - v.x) / d, ty: (e!.y - v.y) / d } : { tx: v.fx, ty: v.fy };
  };
  const views: VehicleView[] = [];
  for (const v of m.vehicles) {
    const sky = (v.kind === 'jet' && v.airborne && insidePolygon(m.map.playArea, v.x, v.y)) || flown(v); // #110: a jet over the Play Area is in both Sides' sky; #101 the Gunship all the way (layers/gunship.ts draws it from its Asset), #139 a drone and the Recon Plane too
    if (!live(v) || (v.side !== side && !seen.has(v.id) && !sky)) continue; // #119: an airborne helicopter too, only when spotted
    const base = { id: v.id, side: v.side, kind: v.kind, x: v.x, y: v.y, fx: v.fx, fy: v.fy, ...turret(v) };
    const rounds = v.rounds.map((r) => ({ from: { x: r.x0, y: r.y0 }, to: { x: r.x, y: r.y }, flight: (m.tick - r.launch) / (r.land - r.launch) }));
    const missiles = v.missiles.map(({ x, y, fx, fy }) => ({ x, y, fx, fy }));
    views.push({ ...base, ...(v.side === side && { hp: v.hp / specOf(m.tune, v.kind).hp, seats: [...v.seats] }), ...(rounds.length && { rounds }), ...(missiles.length && { missiles }), ...(v.seats.every((id) => id < 0) && { empty: true }), ...(v.airborne && { airborne: true }) });
  }
  for (const w of m.wrecks)
    if (w.side === side || w.seen) views.push({ id: -1, side: w.side, kind: w.kind, x: w.x, y: w.y, fx: w.fx, fy: w.fy, tx: w.fx, ty: w.fy, wreck: true });
  return views;
}

export function hashVehicles(m: Match, mix: Mix) {
  for (const v of m.vehicles) {
    for (const n of [v.x, v.y, v.fx, v.fy, v.speed, v.hp, v.lz?.x ?? 0, v.lz?.y ?? 0, v.wp?.x ?? 0, v.wp?.y ?? 0]) mix(Math.round(n * 1000));
    for (const n of [+(v.side === 'nato'), ...v.seats, +v.parked, v.deadAt, v.goal, v.departAt, v.target, v.coax, v.nextFire, v.laid, v.movedAt, v.halt, +v.airborne, v.landedAt, v.claim, v.claimUntil, +!!v.lz, +!!v.wp, v.flareUntil, v.spoolUntil, JOBS.indexOf(v.job), v.fetch, +!!v.spot, v.spin, v.until, +v.drop, v.crashAt, SORTIE.indexOf(v.sortie), v.passes, v.bombs, v.prey, v.route, v.planAt, v.path.length]) mix(n);
    for (const p of v.path) for (const n of [p.x, p.y]) mix(Math.round(n * 1000));
    hashMissiles(v, mix);
    for (const n of [v.spot?.x ?? 0, v.spot?.y ?? 0]) mix(Math.round(n * 1000));
    for (const b of v.bias) mix(Math.round(b * 1000));
    mix(v.rounds.length);
    for (const r of v.rounds) for (const n of [Math.round(r.x0 * 1000), Math.round(r.y0 * 1000), Math.round(r.x * 1000), Math.round(r.y * 1000), r.launch, r.land, +!!r.bomb]) mix(n);
  }
  mix(m.wrecks.length);
  for (const w of m.wrecks) for (const n of [Math.round(w.x * 1000), Math.round(w.y * 1000), +w.seen, w.tick]) mix(n);
}
