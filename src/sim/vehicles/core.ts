// The shared Vehicle rules: each Side's vehicles and slots (`newVehicles`), boarding and riding per Soldier, the shared
// leaving rule, the vehicle phase (`drive`), the eyes and guns, damage, the Console's views and the hash. Each kind's own
// rules are in its module (aa.ts, helicopter.ts, jet.ts, lent.ts), the ground drive step in ground.ts.
import type { Match } from '../index';
import { driveFlow, flowDist } from '../ai/flow';
import { reactAt } from '../ai/squad';
import { between, rnd } from '../rng';
import { blast } from '../assets/strike';
import { die } from '../combat';
import { dist2, inHq, insidePolygon, launchPoint } from '../geometry';
import { hashMissiles, type AirMissile } from '../air-missiles';
import { los, nearestWalkable } from '../grid';
import { see } from '../memory';
import { ticksOf, vehicleOf, type Mix, type Soldier, type Squad } from '../state';
import { SIDES, type SideId, type SimEvent, type Tune, type Vec2, type VehicleKind, type VehicleView } from '../types';
import { aa } from './aa';
import { air, crippled, DORMANT, flies, flown, fresh, held, high, live, riders, SLOTS, SPECS, wreck, type OwnOf, type Round, type Slots, type Vehicle, type VehicleOf } from './body';
import { helicopter } from './helicopter';
import { JOBS } from './helicopter-jobs';
import { jet, SORTIE } from './jet';
import { jeep } from './jeep';
import { gunship, lent } from './lent';
import { tank } from './tank';
import { alight, bail, beam, descend, freeSeats, getOut, goalOf, GUN_OUT_M, jump, stintOver } from './seats';

const squared = (r: number) => r * r;

/**
 * #183: a Vehicle kind's own rules, one entry of the kind table. Each hook answers a question the shared rules ask; a kind
 * without one takes no part in what it asks.
 */
export interface VehicleRules<K extends VehicleKind> {
  /** The record a fresh vehicle of the kind starts with beside its body (`renew`). */
  init(m: Match): OwnOf<K>;
  /** Its tick in the vehicle phase (`drive`) with `halted` true while it stands for a dismount: drive, fly or fly a sortie. None for a lent body: its Asset flies it. */
  move?(m: Match, v: VehicleOf<K>, halted: boolean): void;
  /** Where its driver takes it: the Capture Point its driver picks as it takes the wheel and at each of its Squad's thinks (#107 the tank's, #110 the AA's and the jet's), -1 = none. */
  goal?(m: Match, sq: Squad, s: Soldier, v: VehicleOf<K>): number;
  /** What its driver does with the `goal` it picked at its Squad's think (#123 a ground vehicle takes a route there); unset, it heads there. */
  onGoal?(m: Match, v: VehicleOf<K>, goal: number): void;
  /** #131: at its pilot's Squad think, what it does: a helicopter's job. An EMP Strike's hold keeps it to the one it has (#143). */
  job?(m: Match, v: VehicleOf<K>): void;
  /** The seat `s` takes as it mounts (#129 a helicopter's crew the seat they were sent for, #101 the Gunship's gunner its gun); unset, the first free one. */
  seatFor?(m: Match, v: VehicleOf<K>, s: Soldier): number;
  /** What happens as its driver's seat fills (`wait`: the tick its driver's wait for others ends): #107 a ground vehicle's driver takes the wheel and sets off for its goal, #110 a jet takes off. */
  onDriver?(m: Match, sq: Squad, s: Soldier, v: VehicleOf<K>, wait: number): void;
  /** #107 #110: a Soldier on foot walks up to it at its Squad's think and climbs in alone (`board`): the tank, the AA. */
  boardsOnFoot?: true;
  /** #122: it carries a Squad (`decideRide`): the jeep, #109 the helicopter. */
  rides?: {
    /** Whether `v` fits a ride for `sq`'s foot leader `L` to `p` beyond the shared checks (`fitsRide`): within reach of `L`, and what its kind asks. */
    fits(m: Match, sq: Squad, L: Soldier, v: VehicleOf<K>, p: Vec2, fetched: boolean): boolean;
    /** #131: the Squad it flew to fetch, -1 = none: that Squad takes it first. */
    fetching?(v: VehicleOf<K>): number;
    /** #131: a Squad's claim on it ends any fetch. */
    claimed?(v: VehicleOf<K>): void;
  };
  /** A Soldier coming back from the dead may take a seat here (#110 a jet's pilot, #129 a helicopter's crew, #101 the seats of the lent body on station, `onStation`): true when it did. Only a kind in `RETURN_ORDER` has one, offered in that order. */
  onReturn?: K extends ReturnKind ? (m: Match, sq: Squad, s: Soldier, onStation?: Vehicle) => boolean : never;
  /** Its leaving rule at a rider's think (`ride`); unset, the shared passenger rule (`passengers`). */
  wantsOut?(m: Match, sq: Squad, s: Soldier, v: VehicleOf<K>): boolean;
  /** How its gun ranks what its eyes see (`look`): #107 the tank's main gun, #110 the AA's. */
  rank?: {
    /** How far the gun reaches. */
    range(t: Tune): number;
    /** #110: its eyes also see the air class all round out to that range, over walls (one as high as a jet only over the Play Area). */
    sky?: true;
    /** Where `e`, `d2` square metres off, ranks as its target: lower first, the nearest within a rank; undefined, not its target. */
    of(m: Match, v: VehicleOf<K>, e: Soldier | Vehicle, d2: number): number | undefined;
  };
  /** What `s` aboard fires this tick (`seatFire`), by combat's shot model: the coax or MG (#107 #108), a side gun (#129 #101), #110 the jet's cannon or the AA's bursts. */
  seatFire?(m: Match, s: Soldier, v: VehicleOf<K>, shots: Shots): Shot | null;
  /** #107: its own gun, in the gun pass (`mainGuns`): it lays on its eyes' target, then fires once laid and reloaded. */
  gun?: { lay(m: Match, v: VehicleOf<K>): void; fire(m: Match, v: VehicleOf<K>): void };
  /** #110: its missile's lock, in the lock pass (`lockMissiles`), with a crew aboard: what it holds in its sights (`lockOn`). */
  lock?(m: Match, v: VehicleOf<K>): void;
  /** In both Sides' sky, so every view carries it: #110 a jet over the Play Area, #101 #139 a lent body all the way. */
  inSky?(m: Match, v: VehicleOf<K>): boolean;
}

/** A shot decided from the pre-fire state; combat applies every shot of the tick together afterwards. */
export interface Shot {
  shooter: Soldier;
  target: Soldier | null; // suppressive fire may hit nobody
  hit: boolean;
  damage: number;
  /** Suppressive fire: the aim point, and the enemies close enough to it to be suppressed. */
  at?: Vec2;
  near?: Soldier[];
  /** #107: a Launcher's rocket, or #108 a rifle shot, at this vehicle. */
  vehicle?: Vehicle;
}

/** #183: combat's shot model, handed to a kind's `seatFire`, so that no kind module imports combat.ts. */
export interface Shots {
  /** A shot by `s` at `target` (or at `vehicle`, a hit's damage the caller's to set) that hits with chance `p`; the next is due `every` seconds on, jittered. */
  roll(m: Match, s: Soldier, target: Soldier | null, p: number, every: number, vehicle?: Vehicle): Shot;
  /** Suppressive fire by `s` scattered up to `scatterM` round `aim`; the next is due `every` seconds on. */
  rake(m: Match, s: Soldier, aim: Vec2, scatterM: number, every: number): Shot;
}

let table: { [K in VehicleKind]: VehicleRules<K> } | undefined;
/** #183: the kind table, built on first use, so a kind module imported before this one (as a test may) never meets it half loaded (#142). */
const kinds = (): { [K in VehicleKind]: VehicleRules<K> } => (table ??= { tank, jeep, helicopter, jet, aa, gunship, drone: lent, recon: lent });
/** #183: the rules of `kind`. */
export const rulesOf = <K extends VehicleKind>(kind: K): VehicleRules<K> => kinds()[kind];
/** #183: a fresh vehicle of `kind` in `slot` for `side`: its body (`fresh`) and its kind's own record (`init`) in its slots, every other kind's empty (`SLOTS`: one object shape for every vehicle). */
export const renew = <K extends VehicleKind>(m: Match, side: SideId, kind: K, slot: Vec2) => ({ ...fresh(m, side, kind, slot), ...SLOTS, ...rulesOf(kind).init(m) });
/**
 * #183: the kinds whose seats a Soldier coming back is offered (`onReturn`), in the order `boardOnReturn` offers them: #110 a
 * jet's pilot first, as BF4's deploy screen puts you in the air; #129 then a helicopter's crew; #101 then the Gunship's seats on
 * station. A ground seat comes after them all. No other kind may have the hook.
 */
const RETURN_ORDER = ['jet', 'helicopter', 'gunship'] as const satisfies readonly VehicleKind[];
/** #183: a kind that may seat a Soldier coming back (`RETURN_ORDER`). */
type ReturnKind = (typeof RETURN_ORDER)[number];
let offers: NonNullable<VehicleRules<ReturnKind>['onReturn']>[] | undefined;
/** #183: the seats a Soldier coming back is offered, in their order. */
const onReturnOffers = () => (offers ??= RETURN_ORDER.map((k) => rulesOf(k).onReturn!));

/**
 * The first fresh vehicles (#154: map data). Each Side's HQ tanks, jeeps (#108) and helicopters (#109), then the vehicles each
 * Capture Point lists (#108, `pointJeeps`: for its owner, dormant while it has none), then each Side's jets (#110, at its
 * off-map base) and AAs: last, so every earlier id stays put. A Side's count of a kind is the tune's, else the map's
 * (`countOf`); each waits in its own slot or helipad, and one past them in the Side's row (`rowSlot`).
 */
export function newVehicles(m: Match): Vehicle[] {
  const standing = (side: SideId, kind: VehicleKind, at: Vec2, point: number) => ({ ...renew(m, side, kind, { x: at.x, y: at.y }), point, rounds: [] as Round[], missiles: [] as AirMissile[] });
  const nextInRow: Record<SideId, number> = { nato: 0, pact: 0 };
  const atHqs = (kinds: VehicleKind[]) =>
    SIDES.flatMap((side) => kinds.flatMap((kind) => Array.from({ length: countOf(m, side, kind) }, (_, i) => standing(side, kind, high({ kind }) ? launchPoint(m, side) : (slotsOf(m, side, kind)[i] ?? rowSlot(m, side, nextInRow[side]++)), -1))));
  const atPoints = m.tune.pointJeeps ? m.points.flatMap((p, i) => (m.map.points[i]!.vehicles ?? []).map((u) => ({ ...standing(p.owner ?? 'nato', u.kind, u, i), ...(!p.owner && { deadAt: DORMANT }) }))) : [];
  const gunships = [...atHqs(['gunship']), ...atHqs(['drone', 'recon'])].map((g) => ({ ...g, deadAt: DORMANT })); // #101: after those, asleep until its Asset is called; #139 then each Side's drone and Recon Plane, likewise
  return [...atHqs(['tank', 'jeep', 'helicopter']), ...atPoints, ...atHqs(['jet', 'aa']), ...gunships].map((v, i) => ({ ...v, id: m.soldiers.length + i }) as Vehicle); // each with its kind's record: `renew`
}

/** #154: the map's slots of `kind` for `side` (a helicopter's are its helipads). */
const slotsOf = (m: Match, side: SideId, kind: VehicleKind): Vec2[] => SPECS[kind].slots(m.map, side);

/** #154: a Side's count of `kind`: the tune's number, else the map's (its slots of that kind, or a jet's `jets`). */
const countOf = (m: Match, side: SideId, kind: VehicleKind): number => SPECS[kind].perSide(m.tune, m.map, side) ?? slotsOf(m, side, kind).length;

/** #154: spot `n` of a Side's row, for a vehicle the map has no slot for: 9 m apart toward the field past its last slot, or from the drivable ground nearest the HQ when it lists none. */
function rowSlot(m: Match, side: SideId, n: number): Vec2 {
  const listed = m.map.vehicleSlots?.[side] ?? [];
  const hq = m.map.hqs[side];
  const start = listed.at(-1) ?? nearestWalkable(m, { x: hq.x, y: hq.y }, m.drive[side]);
  const k = n + (listed.length ? 1 : 0);
  return k ? nearestWalkable(m, { x: start.x + (side === 'nato' ? 9 : -9) * k, y: start.y }, m.drive[side]) : start;
}

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
    if (!rulesOf(v.kind).boardsOnFoot || v.side !== s.side || !live(v) || crippled(m, v) || !v.seats.includes(-1) || dist2(s, v) > squared(t.boardM)) continue;
    if (v.id === s.exited && v.seats.some((id) => id >= 0)) continue; // #108: not back into the ride it just left
    const driving = m.points[v.goal];
    if (v.seats[0]! >= 0 && (!driving || dist2(driving, p) > squared(t.sameWayM))) continue;
    const key = dist2(s, v) + (riders(m, v).some((o) => o.squad === s.squad) ? 0 : 1e9);
    if (key < bestKey) [best, bestKey] = [v, key];
  }
  if (best) mount(m, best, s, sq);
}

/**
 * `s` takes its seat in `v` (its kind's `seatFor`, else the first free one); in the driver's seat, its kind's `onDriver`
 * (`takeWheel`: its own preference per Capture Point, seeded and kept for the drive, and the wait for others). #109: a
 * helicopter's first passenger starts the wait for more.
 */
export function mount(m: Match, v: Vehicle, s: Soldier, sq: Squad) {
  const t = m.tune;
  const rules = rulesOf(v.kind);
  const seat = rules.seatFor ? rules.seatFor(m, v, s) : v.seats.indexOf(-1);
  const wait = m.tick + Math.round(t.boardWaitSeconds * t.hz);
  if (v.claim < 0 && air(v) && !s.crew && riders(m, v).every((o) => o.crew)) v.departAt = wait; // its first passenger starts the wait for more
  v.seats[seat] = s.id;
  if (s.crew) s.crewUntil = m.tick + ticksOf(t, between(m, t.crewSeconds));
  if (seat === 0) rules.onDriver?.(m, sq, s, v, wait);
  Object.assign(s, {
    vehicle: v.id, x: v.x, y: v.y, fx: v.fx, fy: v.fy, target: -1, lastTarget: -1, reviving: -1, suppression: 0, away: -1, awaySince: -1,
    dest: null, path: [], cover: null, chaseUntil: 0, role: null, regroup: false, strayUntil: 0, // a Detached rider keeps its own goal
  });
}

/**
 * A Soldier coming back from the dead (Squad Respawn or Redeploy) takes a seat if one waits for it: first the seats the kinds
 * offer (`onReturn`, in `RETURN_ORDER`: #110 a jet's pilot, #129 a helicopter's crew, #101 then the Gunship's), else in the Squad Leader's vehicle
 * while the leader rides one, else as the driver of a friendly ground vehicle with nobody driving (fit to fight: a third of its
 * hit points or more). True when it did. #109: never into a helicopter in the air. #101: `onStation`, the Side's Gunship on station
 * (its Asset's effect says so: respawn.ts reads it), whose seats come after a jet's and a helicopter's crew.
 */
export function boardOnReturn(m: Match, sq: Squad, s: Soldier, onStation?: Vehicle): boolean {
  if (onReturnOffers().some((take) => take(m, sq, s, onStation))) return true;
  const lead = m.soldiers[sq.members[0]!]!;
  const mine = lead.state === 'alive' ? vehicleOf(m, lead.vehicle) : undefined;
  const v = mine && freeSeats(mine) > 0 && !mine.airborne ? mine : m.vehicles.find((o) => o.side === s.side && live(o) && !o.airborne && SPECS[o.kind].layer === 'ground' && o.seats[0] === -1 && !crippled(m, o));
  if (!v) return false;
  mount(m, v, s, sq);
  return true;
}

/**
 * Whether `v` fits a ride for `sq`'s `body` (foot leader `L`) to `p`: see `decideRide`. `fetched`: a helicopter that is fetching the
 * Squad (#131) fits from where it landed on its pickup Landing Zone, not only within `boardM`.
 */
export function fitsRide(m: Match, sq: Squad, body: Soldier[], L: Soldier, v: Vehicle, p: Vec2, fetched: boolean): boolean {
  const rides = rulesOf(v.kind).rides;
  return !!rides && v.side === sq.side && live(v) && !v.airborne && !crippled(m, v) && v.claim < 0 && v.seats.every((id) => id < 0 || m.soldiers[id]!.crew) &&
    freeSeats(v) >= Math.max(1, body.length - 1) && rides.fits(m, sq, L, v, p, fetched); // #129: a pilot seat is for crew
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
  const fetching = (o: Vehicle) => rulesOf(o.kind).rides?.fetching?.(o) === sq.id;
  const v = fits.find(fetching) ?? fits[pick]!; // #131: the helicopter that came for it
  const seats = freeSeats(v);
  const left = body.length > seats ? body.reduce((a, s) => (dist2(s, v) > dist2(a, v) ? s : a)) : null;
  if (left) Object.assign(left, { detached: true, goal: -1, commitUntil: m.tick + ticksOf(t, t.commitSeconds[1]) }); // walks the Squad's goal as its own Commitment
  const walk = fetching(v) ? Math.sqrt(Math.max(...body.map((s) => dist2(s, v)))) / (0.8 * t.walkSpeed) : 0; // #131: a helicopter that came lands up to `lzM` away: the wait includes the walk
  const claimUntil = m.tick + Math.round((t.boardWaitSeconds + walk) * t.hz);
  Object.assign(v, { claim: sq.id, claimUntil, departAt: claimUntil });
  rulesOf(v.kind).rides?.claimed?.(v);
  for (const s of body)
    if (s !== left) Object.assign(s, { boarding: v.id, climbAt: 0, dest: null, path: [], cover: null, holdUntil: reactAt(m, s) });
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

/** Where `s` drives `v` (its kind's `goal`, -1 = none). Exported for tests. */
export const drivePoint = (m: Match, sq: Squad, s: Soldier, v: Vehicle): number => rulesOf(v.kind).goal?.(m, sq, s, v) ?? -1;

/**
 * At its Squad's think, a Soldier aboard: the driver picks where it takes the vehicle (its kind's `goal`; Retreat and Resupply
 * ignore it) and #131 a helicopter's pilot its job. One who wants out (`wantsOut`) gets out once the vehicle has stood
 * `dismountStopSeconds`, stopping it for that first; Detached when away from the Squad. #110: a jet's pilot picks the point of its
 * next pass, and never gets out.
 */
export function ride(m: Match, sq: Squad, s: Soldier) {
  const t = m.tune;
  const v = vehicleOf(m, s.vehicle)!;
  const rules = rulesOf(v.kind);
  if (v.seats[0] === s.id) {
    if (rules.job && !held(m, v)) { // #143: an EMP holds it to its job, as to its place
      rules.job(m, v);
      if (s.vehicle < 0) return; // the pilot bailed out
    }
    if (rules.goal) {
      const goal = rules.goal(m, sq, s, v);
      if (rules.onGoal) rules.onGoal(m, v, goal);
      else v.goal = goal;
    }
  }
  if (!(rules.wantsOut ?? passengers)(m, sq, s, v)) return;
  if (v.airborne) return jump(m, s);
  if (m.tick - v.movedAt < Math.round(t.dismountStopSeconds * t.hz)) {
    if (v.halt < 0) v.halt = m.tick; // nobody bails at speed
    return;
  }
  getOut(m, s, v);
}

/**
 * The shared leaving rule (#27, #108), at think, for a kind with none of its own (`wantsOut`): everyone gets out under a third of
 * the hit points; #129 crew (a helicopter's, drawn into its Squad's ride on the way to it) once their stint is over (`stintOver`);
 * anyone else by the shared passenger rule (`alight`), the drive's end its goal and its drive distance counting.
 */
const passengers = (m: Match, sq: Squad, s: Soldier, v: Vehicle) =>
  crippled(m, v) || (s.crew ? stintOver(m, s, v) : alight(m, sq, s, v, () => flowDist(m, driveFlow(m, v.side, v.goal), v) === 0, true));

/**
 * The vehicle phase, after the Soldiers walk: fresh vehicles in empty slots `vehicleRespawnSeconds` after the last one died
 * (#108: a point's for its owner, at once when the point first has one or has changed hands; #154 so does a live one with
 * nobody aboard standing in its slot, so a captured point never keeps the enemy's parked vehicle), then each takes its kind's
 * tick (`move`: a ground vehicle with a driver drives, #109 a helicopter flies, #110 a jet flies its sortie; #101 #139 its Asset
 * flies a lent body) unless an EMP Strike holds it (#143); a halt for a dismount lasts long enough for everyone who wants out
 * to have thought once. Its riders ride along.
 */
export function drive(m: Match) {
  const t = m.tune;
  descend(m); // #130
  for (const v of m.vehicles) {
    const side = v.point < 0 ? v.side : m.points[v.point]!.owner;
    if (!live(v)) {
      if (flown(v)) continue; // #101 #139: only its Asset's next call brings it back
      if (side && (v.deadAt === DORMANT || side !== v.side || m.tick - v.deadAt >= t.vehicleRespawnSeconds * t.hz)) Object.assign(v, renew(m, side, v.kind, v.slot));
      continue;
    }
    if (side && side !== v.side && v.seats.every((id) => id < 0) && dist2(v, v.slot) < 1) Object.assign(v, renew(m, side, v.kind, v.slot));
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
    if (held(m, v)) v.speed = 0; // #143: momentum to zero where it is, a helicopter in the air too (no kind an EMP reaches flies higher)
    else rulesOf(v.kind).move?.(m, v, halted);
    v.seats.forEach((id, k) => {
      const s = m.soldiers[id];
      const out = air(v) ? beam(v, k) : null; // #129: a gun seat's Soldier sits out to its side
      if (s) Object.assign(s, { x: v.x + (out ? out.x * GUN_OUT_M : 0), y: v.y + (out ? out.y * GUN_OUT_M : 0), fx: v.fx, fy: v.fy, ammo: t.ammo, suppression: 0 }); // no ammo worries
    });
  }
}

/**
 * Perception, for each vehicle with anyone aboard: one pair of eyes from the hull (the Soldier cone and line of sight at `vehicleVisionMul`
 * x `visionM`) on enemy Soldiers on foot and enemy vehicles; what it sees goes into the memory of every Squad with a rider aboard. Its
 * gun, if its kind has one that ranks targets (`rank`: #107 the tank's main gun, #110 the AA's), takes the best-ranked in range, the
 * nearest within a rank; the coax (#108: or a jeep's MG) the nearest infantry in its range. #109: a helicopter's eyes see a full
 * circle out to `airVisionM`, over walls (its door gun fires as the MG); anyone's eyes see an airborne vehicle over walls. #110: a jet
 * sees nothing, and only eyes that see the sky (`rank.sky`: the AA's) see one, over the Play Area. #101: the Gunship's own riders look
 * at nothing (its Asset says what it sees, and its gunner's side gun picks its own target, as a helicopter's).
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
  const rank = rulesOf(v.kind).rank;
  const range = rank?.range(t) ?? 0;
  const skySees = (u: Vehicle) => dist2(v, u) <= squared(range) && !inHq(m, u.side, u) && (!high(u) || insidePolygon(m.map.playArea, u.x, u.y));
  let best: { id: number; rank: number; d2: number } | null = null;
  const consider = (e: Soldier | Vehicle, d2: number) => {
    const r = rank?.of(m, v, e, d2);
    if (r !== undefined && d2 <= squared(range) && (!best || r < best.rank || (r === best.rank && d2 < best.d2))) best = { id: e.id, rank: r, d2 };
  };
  let coaxD2 = squared(SPECS[v.kind].gunM(t));
  for (const e of m.soldiers) {
    if (e.side === v.side || e.state !== 'alive' || e.vehicle >= 0 || !sees(e)) continue;
    if (!m.sightings[v.side].some((o) => o.id === e.id && o.tick >= m.tick - 1)) e.uavUntil = -1; // #75, as for a Soldier's eyes
    for (const sq of squads) see(m, sq, e);
    const d2 = dist2(v, e);
    consider(e, d2);
    if (d2 <= coaxD2) [v.coax, coaxD2] = [e.id, d2];
  }
  for (const u of m.vehicles) {
    const sky = !!rank?.sky && flies(u);
    if (u.side === v.side || !live(u) || (high(u) && !sky) || !(sky ? skySees(u) : sees(u))) continue;
    for (const sq of squads) see(m, sq, u);
    consider(u, dist2(v, u));
  }
  if (best || v.coax >= 0) for (const sq of squads) sq.lastSeen = m.tick;
  v.target = (best as { id: number } | null)?.id ?? -1;
}

/**
 * A Soldier on foot sees an enemy vehicle at `vehicleVisionMul` x its range, in its cone and line of sight, outside its HQ.
 * #108: the nearest jeep (#109: or helicopter) it sees closer than `withinD2` (metres squared), a rifle target, or null.
 * #109: an airborne one over walls. #110: never a jet (only an AA sees one; #101 nor the Gunship); armour (a tank, an AA) is seen, but no rifle target.
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
    if (!SPECS[v.kind].armour && d2 < withinD2) [jeep, withinD2] = [v, d2];
  }
  return jeep;
}

/** What `v`'s main gun is laid on: a Soldier or a vehicle, or undefined. */
export const targetOf = (m: Match, v: Vehicle): Vec2 | undefined => m.soldiers[v.target] ?? vehicleOf(m, v.target);

/**
 * The combat phase: the gun pass, each kind's own gun in vehicle order (`gun`: #107 a tank's main gun fires a round that flies to
 * its target's spot); then every round due lands, a Strike-shaped impact hitting the enemy's vehicles in its kill radius:
 * `tankVsVehicleDamage` on armour (a tank, #110 an AA), anything lighter destroyed. No Commander is paid for what it kills. #110: a
 * jet's bombs land the same way, each a blast of its own (`jetBomb*`), friend or foe as a Strike's, never on the air.
 */
export function mainGuns(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const v of m.vehicles) {
    const gun = rulesOf(v.kind).gun;
    if (!gun) continue;
    gun.lay(m, v);
    if (!held(m, v)) gun.fire(m, v); // #143: nor while an EMP holds it (its rounds in the air still land)
  }
  for (const v of m.vehicles)
    for (const r of v.rounds.filter((r) => r.land <= m.tick)) {
      events.push({ kind: 'impact', side: v.side, x: r.x, y: r.y, asset: r.bomb ? 'bomb' : 'tank', from: v.id });
      if (r.bomb) blast(m, v.side, r, { killM: t.jetBombKillM, woundM: t.jetBombWoundM, suppressM: t.jetBombSuppressM, suppression: 1 }, null, events, { damage: (u) => (u.airborne ? 0 : t.jetBombVehicleDamage) });
      else blast(m, v.side, r, { killM: t.tankKillM, woundM: t.tankWoundM, suppressM: t.tankSuppressM, suppression: t.tankSuppression }, null, events, { damage: (u) => (SPECS[u.kind].armour ? t.tankVsVehicleDamage : Infinity), foesOnly: true });
      v.rounds.splice(v.rounds.indexOf(r), 1);
    }
}

/** #110: the lock pass: each crewed vehicle whose kind locks a missile on (`lock`), not out of its own HQ (combat.ts fire), nor while an EMP holds it (#143). */
export function lockMissiles(m: Match) {
  for (const v of m.vehicles) {
    const lock = rulesOf(v.kind).lock;
    if (lock && live(v) && v.seats[0]! >= 0 && !held(m, v) && !inHq(m, v.side, v)) lock(m, v);
  }
}

/** #107: what `s` aboard `v` fires this tick: its kind's `seatFire`, by combat's shot model; nothing while an EMP holds `v` (#143). */
export const seatFire = (m: Match, s: Soldier, v: Vehicle, shots: Shots): Shot | null => (held(m, v) ? null : (rulesOf(v.kind).seatFire?.(m, s, v, shots) ?? null));

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
  if (SPECS[v.kind].ridersBail) bail(m, v);
  for (const s of riders(m, v)) {
    if (cause && by !== s.side) s.cause = cause;
    die(m, s, events);
  }
  wreck(m, v);
}

export function vehicleViews(m: Match, side: SideId, seen: Set<number>): VehicleView[] {
  const turret = (v: Vehicle) => {
    const e = targetOf(m, v);
    const d = e ? Math.sqrt(dist2(v, e)) : 0;
    return d > 0 ? { tx: (e!.x - v.x) / d, ty: (e!.y - v.y) / d } : { tx: v.fx, ty: v.fy };
  };
  const views: VehicleView[] = [];
  for (const v of m.vehicles) {
    const sky = !!rulesOf(v.kind).inSky?.(m, v); // #110 #101 #139 (layers/gunship.ts draws the Gunship from its Asset)
    if (!live(v) || (v.side !== side && !seen.has(v.id) && !sky)) continue; // #119: an airborne helicopter too, only when spotted
    const base = { id: v.id, side: v.side, kind: v.kind, x: v.x, y: v.y, fx: v.fx, fy: v.fy, ...turret(v) };
    const rounds = v.rounds.map((r) => ({ from: { x: r.x0, y: r.y0 }, to: { x: r.x, y: r.y }, flight: (m.tick - r.launch) / (r.land - r.launch) }));
    const missiles = v.missiles.map(({ x, y, fx, fy }) => ({ x, y, fx, fy }));
    views.push({ ...base, ...(v.side === side && { hp: v.hp / SPECS[v.kind].hp(m.tune), seats: [...v.seats] }), ...(rounds.length && { rounds }), ...(missiles.length && { missiles }), ...(v.seats.every((id) => id < 0) && { empty: true }), ...(v.airborne && { airborne: true }), ...(held(m, v) && { disabled: true as const }) });
  }
  for (const w of m.wrecks)
    if (w.side === side || w.seen) views.push({ id: -1, side: w.side, kind: w.kind, x: w.x, y: w.y, fx: w.fx, fy: w.fy, tx: w.fx, ty: w.fy, wreck: true });
  return views;
}

export function hashVehicles(m: Match, mix: Mix) {
  for (const v of m.vehicles) {
    // #183: the row the one-record Vehicle hashed, read off the body and its kind's record; a slot its kind has no field for holds what a fresh one held
    const { gun, missile, heli, sortie, burstUntil, drive = { route: -1, planAt: 0, path: [] } }: Slots = v;
    const aim = gun ? { on: gun.laid, nextFire: gun.nextFire } : missile ? { on: missile.lock, nextFire: missile.nextFire } : { on: -1, nextFire: 0 }; // the old `laid` and `nextFire`: a tank's gun, else an AA's or a jet's missile lock
    const spot = heli ? heli.spot : (sortie?.at ?? null);
    const until = heli?.until ?? burstUntil ?? sortie?.until ?? -1;
    for (const n of [v.x, v.y, v.fx, v.fy, v.speed, v.hp, heli?.lz?.x ?? 0, heli?.lz?.y ?? 0, heli?.wp?.x ?? 0, heli?.wp?.y ?? 0]) mix(Math.round(n * 1000));
    for (const n of [
      +(v.side === 'nato'), ...v.seats, +v.parked, v.deadAt, v.goal, v.departAt, v.target, v.coax, aim.nextFire, aim.on, v.movedAt, v.halt, +v.airborne, heli?.landedAt ?? -1, v.claim, v.claimUntil,
      +!!heli?.lz, +!!heli?.wp, heli?.flareUntil ?? -1, heli?.spoolUntil ?? -1, JOBS.indexOf(heli?.job ?? 'wait'), heli?.fetch ?? -1, +!!spot, heli?.spin ?? sortie?.turn ?? 1, until, +(heli?.hotDrop ?? sortie?.bomb ?? false),
      heli?.crashAt ?? -1, SORTIE.indexOf(sortie?.stage ?? 'idle'), sortie?.passes ?? 0, sortie?.bombs ?? 0, sortie?.prey ?? -1, drive.route, drive.planAt, drive.path.length, v.disabledUntil,
    ]) mix(n);
    for (const p of drive.path) for (const n of [p.x, p.y]) mix(Math.round(n * 1000));
    hashMissiles(v, mix);
    for (const n of [spot?.x ?? 0, spot?.y ?? 0]) mix(Math.round(n * 1000));
    for (const b of v.bias) mix(Math.round(b * 1000));
    mix(v.rounds.length);
    for (const r of v.rounds) for (const n of [Math.round(r.x0 * 1000), Math.round(r.y0 * 1000), Math.round(r.x * 1000), Math.round(r.y * 1000), r.launch, r.land, +!!r.bomb]) mix(n);
  }
  mix(m.wrecks.length);
  for (const w of m.wrecks) for (const n of [Math.round(w.x * 1000), Math.round(w.y * 1000), +w.seen, w.tick]) mix(n);
}
