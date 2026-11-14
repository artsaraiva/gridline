// #109: the transport helicopter: #129 its crew (`crewOnReturn`, `decideCrew`), the passengers' goal (`ferryGoal`), the trip
// (`plan`, #124), and its flight on the ground (`fly`) and in the air (`cruise`). Its jobs are in helicopter-jobs.ts, its Landing
// Zones and doglegs in flight.ts.
import type { Match } from '../index';
import { reactAt } from '../ai/squad';
import { clearOfHq, dist2 } from '../geometry';
import { sideKnown } from '../memory';
import { approach, BRAKE_RESERVE, stopSpeed, turnToward } from '../momentum';
import { rnd } from '../rng';
import { membersOf, ticksOf, type Soldier, type Squad } from '../state';
import { enemyOf, type Vec2 } from '../types';
import { air, crippled, live, riders, type Vehicle, type VehicleOf } from './body';
import { mount, type VehicleRules } from './core';
import { dogleg, landingZone } from './flight';
import { circle, decideJob, glide, repairOnPad, spinFor, type Job } from './helicopter-jobs';
import { alight, CREW_SEATS, goalOf, inReach, jump, onPad, seatGun, sideGun, startCrew, stintOver, takeWheel } from './seats';

const squared = (r: number) => r * r;

/**
 * #109 #124 #131: what a helicopter is doing and where: its `job` (decided at its pilot's Squad think), the Squad it is flying to
 * `fetch` (-1 = none), the `spot` it is bound for (fetching, the pickup Landing Zone) or circles (Support, or over a hot goal), which
 * way it circles (`spin`: 1 counter-clockwise, the centre on its left; -1 clockwise), the tick its Support Commitment or its orbit
 * over a hot goal ends (`until`, -1 = not begun), whether its riders jump over their Landing Zone (`hotDrop`: a hot goal) instead of
 * it landing, its Landing Zone for the trip out (`lz`, kept after touchdown: its passengers get out there) and the dogleg's waypoint
 * still ahead (`wp`), the ticks its hover ends in a touchdown (`flareUntil`) and its rotor is up to lift off (`spoolUntil`), the tick
 * it last touched down (`landedAt`), and the tick it hits the ground once bailed out of (`crashAt`); -1 = none for each tick.
 */
export interface Heli {
  job: Job;
  fetch: number;
  spot: Vec2 | null;
  spin: number;
  until: number;
  hotDrop: boolean;
  lz: Vec2 | null;
  wp: Vec2 | null;
  flareUntil: number;
  spoolUntil: number;
  landedAt: number;
  crashAt: number;
}
export type Helicopter = VehicleOf<'helicopter'>;

/** The first empty pilot or gun seat of `v` that none of `crew` (aboard or on their way to `v`) holds. */
const freeCrewSeat = (v: Vehicle, crew: Soldier[]) => CREW_SEATS.find((k) => v.seats[k]! < 0 && !crew.some((o) => o.crewSeat === k && (o.vehicle === v.id || o.boarding === v.id)));

/**
 * #129: by a seeded `crewSpawnChance`, a Soldier coming back anywhere (Squad Respawn included, not only at the HQ: BF4's deploy screen puts you into the helicopter from anywhere; never the Squad Leader, and no other member of its Squad crewing)
 * takes the first empty pilot or gun seat, not reserved by crew on their way, of a friendly helicopter on its helipad, its crew stint
 * starting now. True when it did.
 */
export function crewOnReturn(m: Match, sq: Squad, s: Soldier): boolean {
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
 * #109 #129 #131: its leaving rule. Its passengers leave it under repair (in the air by parachute, `decideJob`) while its crew stay at
 * their seats; nobody gets out in the air; its crew only once their stint is over (`stintOver`); its passengers by the shared rule
 * (`alight`), at its Landing Zone and never by drive distance (it flies straight to their majority's goal).
 */
function wantsOut(m: Match, sq: Squad, s: Soldier, v: Helicopter): boolean {
  if (v.heli.job === 'repair' && !s.crew) return true;
  if (v.airborne) return false;
  if (s.crew) return stintOver(m, s, v);
  return alight(m, sq, s, v, () => !!v.heli.lz && dist2(v, v.heli.lz) < 1, false);
}

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

/** #131: where a helicopter is bound for: the pickup Landing Zone it is fetching to, the point it supports, else its passengers' Landing Zone, else home. */
const bound = (v: Helicopter): Vec2 => ((v.heli.job === 'ferry' && v.heli.fetch >= 0) || v.heli.job === 'support' ? v.heli.spot : null) ?? (v.goal >= 0 && v.heli.lz ? v.heli.lz : v.slot);

/**
 * #124, as it lifts off: the trip. Going out, a Landing Zone for the passengers' goal (`landingZone`: away from the enemies its
 * riders' Squads know); out or home, a dogleg waypoint (`dogleg`) that keeps off enemy-held points and known enemies. #131: with a
 * known enemy within `lzThreatM` of the goal (any friendly Squad's) it is a hot goal: its riders jump over the Landing Zone, after circling the point first if a gunner is aboard.
 */
export function plan(m: Match, v: Helicopter) {
  const known = sideKnown(m, v.side); // #133: any friendly Squad's eyes
  const threats = [...m.points.filter((p) => p.owner === enemyOf(v.side)).map((p) => ({ x: p.x, y: p.y, r: p.radius })), ...known.map((e) => ({ x: e.x, y: e.y, r: 0 }))];
  if (v.goal >= 0) {
    const p = m.points[v.goal]!;
    v.heli.lz = landingZone(m, p, known, (q) => clearOfHq(m, v.side, q, 1));
    const hot = sideKnown(m, v.side).some((e) => e.source !== 'marked' && dist2(e, p) <= squared(m.tune.lzThreatM)); // #131: any friendly Squad's eyes; #136: not a Mark, a guess is no reason to jump (it still turns the Landing Zone away)
    const circles = hot && (v.seats[1]! >= 0 || v.seats[2]! >= 0); // with no gunner, circling is pointless (#128): the riders still jump
    Object.assign(v.heli, { spot: circles ? { x: p.x, y: p.y } : null, hotDrop: hot, until: -1, ...(circles && { spin: spinFor(m, v) }) });
  }
  v.heli.wp = dogleg(m, v, bound(v), threats);
}

/**
 * #109, one tick of a piloted helicopter: it takes its passengers to their goal's Landing Zone (#124), empty it goes home to its
 * slot, and sets down there. On the ground it lifts off only `unloadSeconds` after it landed, with free seats not before its first
 * passenger's wait is over, and spools its rotor `spoolSeconds` first (`plan` draws the trip as it lifts); it never stays at a goal
 * its passengers are leaving. A new goal ends the trip's Landing Zone: in the air it plans afresh, on the ground at lift-off (a
 * Landing Zone kept from the last trip would hold it down and empty every Squad that climbs in). #131: its job sends it elsewhere
 * (`bound`): a pickup it waits at for the Squad it came for, or a point to circle. Airborne, see `cruise`.
 */
export function fly(m: Match, v: Helicopter) {
  const t = m.tune;
  const goal = ferryGoal(m, v);
  if (goal !== v.goal) {
    v.goal = goal;
    if (goal >= 0) v.heli.lz = null; // emptied (-1), it keeps the last one: its passengers got out there
    if (v.airborne && v.heli.flareUntil < 0) plan(m, v);
  }
  if (v.airborne) return cruise(m, v);
  const there = v.heli.spot && bound(v) === v.heli.spot ? dist2(v, v.heli.spot) < 1 : v.goal >= 0 ? !!v.heli.lz && dist2(v, v.heli.lz) < 1 : dist2(v, v.slot) < 1e-4;
  const held = (v.heli.landedAt >= 0 && m.tick - v.heli.landedAt < Math.round(t.unloadSeconds * t.hz)) || (v.seats.includes(-1) && m.tick < v.departAt);
  if (there || held) return void (v.heli.spoolUntil = -1);
  if (v.heli.spoolUntil < 0) v.heli.spoolUntil = m.tick + Math.round(t.spoolSeconds * t.hz);
  if (m.tick < v.heli.spoolUntil) return;
  v.heli.spoolUntil = -1;
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
function cruise(m: Match, v: Helicopter) {
  const t = m.tune;
  if (v.heli.flareUntil >= 0) {
    v.speed = approach(v.speed, 0, t.heliAccel, 1, t.hz); // the last of the braking
    if (m.tick < v.heli.flareUntil) return;
    if (!v.heli.hotDrop) {
      Object.assign(v, { airborne: false, parked: true });
      return void Object.assign(v.heli, { landedAt: m.tick, flareUntil: -1 });
    }
    for (const s of riders(m, v)) if (!s.crew) jump(m, s); // over the Landing Zone
    Object.assign(v.heli, { flareUntil: -1, hotDrop: false, spot: null });
    return;
  }
  if (v.heli.hotDrop && v.heli.spot && !v.heli.wp && v.heli.until >= 0 && m.tick >= v.heli.until) v.heli.spot = null; // the orbit is over
  if (v.heli.spot && !v.heli.wp && (v.heli.job === 'support' || (v.heli.hotDrop && (v.heli.until >= 0 || dist2(v, v.heli.spot) <= squared(1.25 * t.orbitM))))) {
    if (v.heli.hotDrop && v.heli.until < 0) v.heli.until = m.tick + ticksOf(t, t.orbitSeconds);
    return circle(m, v, v.heli.spot);
  }
  const to = bound(v);
  let aim = v.heli.wp ?? to;
  let d = Math.sqrt(dist2(v, aim));
  if (v.heli.wp && d <= Math.max(2, v.speed)) {
    v.heli.wp = null;
    aim = to;
    d = Math.sqrt(dist2(v, aim));
  }
  const left = d + (v.heli.wp ? Math.sqrt(dist2(v.heli.wp, to)) : 0);
  let { fx, fy } = v;
  let want = 0;
  if (d >= 0.01) {
    const way = { x: (aim.x - v.x) / d, y: (aim.y - v.y) / d };
    ({ fx, fy } = turnToward(fx, fy, way.x, way.y, t.heliTurnDegPerS, t.hz));
    const align = Math.max(0, fx * way.x + fy * way.y);
    want = Math.min(t.heliMps * (t.turnSpeedMin + (1 - t.turnSpeedMin) * align), stopSpeed(left, t.heliAccel, 1, BRAKE_RESERVE));
  }
  const speed = approach(v.speed, want, t.heliAccel, 1, t.hz); // braking no harder than speeding up
  const arrived = !v.heli.wp && (d < 0.01 || speed / t.hz >= d);
  const at = arrived ? aim : clearOfHq(m, v.side, { x: v.x + (fx * speed) / t.hz, y: v.y + (fy * speed) / t.hz });
  Object.assign(v, { x: at.x, y: at.y, fx, fy, speed, movedAt: m.tick });
  if (arrived) v.heli.flareUntil = m.tick + ticksOf(t, t.flareSeconds);
}

export const helicopter: VehicleRules<'helicopter'> = {
  init: () => ({ heli: { job: 'wait', fetch: -1, spot: null, spin: 1, until: -1, hotDrop: false, lz: null, wp: null, flareUntil: -1, spoolUntil: -1, landedAt: -1, crashAt: -1 } }),
  /** #109 #131: bailed out of, it glides on to its crash; piloted, it flies (not while it stands for a dismount); on its helipad it repairs. */
  move(m, v, halted) {
    if (v.heli.job === 'bail') glide(m, v);
    else if (!halted && v.seats[0]! >= 0) fly(m, v);
    repairOnPad(m, v);
  },
  job: decideJob,
  seatFor: (_m, v, s) => (s.crew ? s.crewSeat : [3, 4, 5, 1, 2].find((k) => v.seats[k]! < 0)!), // #129: its crew take the seat they were sent for (pilot, then guns); riders fill the passenger seats first
  onDriver: (m, _sq, _s, v, wait) => void takeWheel(m, v, wait), // its pilot picks no goal: `fly` ferries the passengers'
  rides: {
    /** #122 #129 #131: not while it repairs, with its pilot aboard or on the way, and only for a goal beyond `heliFitM` or across the river; a helicopter fetching the Squad fits from where it landed on its pickup Landing Zone, not only within reach. */
    fits: (m, sq, L, v, p, fetched) =>
      v.heli.job !== 'repair' && (inReach(m, L, v) || (fetched && v.heli.fetch === sq.id && !!v.heli.spot && dist2(v, v.heli.spot) < 1)) && (v.seats[0]! >= 0 || m.soldiers.some((s) => s.crew && s.boarding === v.id)) &&
      (dist2(L, p) > squared(m.tune.heliFitM) || sq.route >= 0),
    fetching: (v) => v.heli.fetch,
    claimed: (v) => void (v.heli.fetch = -1),
  },
  onReturn: crewOnReturn,
  wantsOut,
  seatFire: (m, s, v, shots) => seatGun(m, s, v, sideGun(m, v, v.seats.indexOf(s.id)), shots), // #129: a gun per side seat
};
