// The shared Vehicle rules: each Side's vehicles and slots (`newVehicles`), boarding and riding per Soldier, the shared
// leaving rule, the vehicle phase (`drive`), the eyes and guns, damage, the Console's views and the hash. Each kind's own
// rules are in its module (aa.ts, helicopter.ts, jet.ts, lent.ts), the ground drive step in ground.ts.
import type { Match } from '../index';
import { driveFlow, flowDist } from '../ai/flow';
import { bestPoint, reactAt } from '../ai/squad';
import { between, rnd } from '../rng';
import { blast } from '../assets/strike';
import { die } from '../combat';
import { cosDeg } from '../momentum';
import { dist2, inHq, insidePolygon } from '../geometry';
import { launchPoint } from '../assets/missile';
import { hashMissiles, type AirMissile } from '../air-missiles';
import { los, nearestWalkable } from '../grid';
import { see, sideKnown } from '../memory';
import { ticksOf, vehicleOf, type Mix, type Soldier, type Squad } from '../state';
import { SIDES, type SideId, type SimEvent, type Vec2, type VehicleKind, type VehicleView } from '../types';
import { aaPoint } from './aa';
import { air, crippled, DORMANT, flies, flown, fresh, held, high, live, riders, SPECS, unmanned, wreck, type Round, type Vehicle } from './body';
import { pickRoute } from './drive-route';
import { step } from './ground';
import { crewOnReturn, fly } from './helicopter';
import { decideJob, glide, JOBS, repairOnPad } from './helicopter-jobs';
import { jetOnReturn, jetPoint, SORTIE, sortie, takeOff } from './jet';
import { GUNSHIP_GUN, gunshipOnReturn } from './lent';
import { bail, beam, descend, freeSeats, getOut, goalOf, GUN_OUT_M, jump, onPad } from './seats';

const squared = (r: number) => r * r;

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

/** #154: the map's slots of `kind` for `side` (a helicopter's are its helipads). */
const slotsOf = (m: Match, side: SideId, kind: VehicleKind): Vec2[] => (kind === 'helicopter' ? (m.map.helipad?.[side] ?? []) : (m.map.vehicleSlots?.[side] ?? []).filter((s) => s.kind === kind));

/** #154: a Side's count of `kind`: the tune's number, else the map's (its slots of that kind, or its `jets`). */
function countOf(m: Match, side: SideId, kind: VehicleKind): number {
  const t = m.tune;
  const n = SPECS[kind].perSide(t);
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
    } else if (held(m, v)) v.speed = 0; // #143: momentum to zero where it is, a helicopter in the air too
    else if (air(v)) {
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
  let coaxD2 = squared(SPECS[v.kind].gunM(t));
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
  let bestD2 = squared(SPECS[v.kind].gunM(t));
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
    if (!live(v) || v.seats[0]! < 0 || !e || held(m, v) || m.tick < v.nextFire || dist2(v, e) > t.tankRangeM * t.tankRangeM || inHq(m, v.side, v)) continue; // nor out of its own HQ (combat.ts fire); #143 nor while an EMP holds it (its rounds in the air still land)
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
    const sky = (v.kind === 'jet' && v.airborne && insidePolygon(m.map.playArea, v.x, v.y)) || flown(v); // #110: a jet over the Play Area is in both Sides' sky; #101 the Gunship all the way (layers/gunship.ts draws it from its Asset), #139 a drone and the Recon Plane too
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
    for (const n of [v.x, v.y, v.fx, v.fy, v.speed, v.hp, v.lz?.x ?? 0, v.lz?.y ?? 0, v.wp?.x ?? 0, v.wp?.y ?? 0]) mix(Math.round(n * 1000));
    for (const n of [+(v.side === 'nato'), ...v.seats, +v.parked, v.deadAt, v.goal, v.departAt, v.target, v.coax, v.nextFire, v.laid, v.movedAt, v.halt, +v.airborne, v.landedAt, v.claim, v.claimUntil, +!!v.lz, +!!v.wp, v.flareUntil, v.spoolUntil, JOBS.indexOf(v.job), v.fetch, +!!v.spot, v.spin, v.until, +v.drop, v.crashAt, SORTIE.indexOf(v.sortie), v.passes, v.bombs, v.prey, v.route, v.planAt, v.path.length, v.disabledUntil]) mix(n);
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
