// Getting in and out of a Vehicle (#107 #108): the seats (who holds which, the free ones, #129 a helicopter's pad and the side
// each gun seat sits out to), the Capture Point a rider is heading for, a driver taking the wheel, a crew stint's start (#129),
// the shared passenger rule (`alight`), getting out on foot, the parachute jump and its descent (#130), and leaving a seat for good.
import type { Match } from '../index';
import { driveFlow, flowDist } from '../ai/flow';
import { canStand, dist2, inHq } from '../geometry';
import { cellAt, COVER, nearestWalkable } from '../grid';
import { cosDeg } from '../momentum';
import { rnd } from '../rng';
import { footLeader, membersOf, ticksOf, vehicleOf, type Soldier, type Squad } from '../state';
import { air, riders, SPECS, type Vehicle } from './body';
import type { Shot, Shots } from './core';

const squared = (r: number) => r * r;

/** Helicopter seat indices: the pilot's, then the guns' (#129); the passenger seats follow. */
export const PILOT_SEAT = 0;
export const CREW_SEATS = [0, 1, 2];
/** Who fires a ground vehicle's second-seat gun: seat 1. #129: a helicopter has a gun per side instead (`sideGun`). */
export const gunner = (v: Vehicle) => v.seats[1]!;
/** #129: standing on its helipad (its slot), down. */
export const onPad = (v: Vehicle) => !v.airborne && dist2(v, v.slot) < 1;
/** Seats a passenger may take: all but a helicopter's pilot seat. */
export const freeSeats = (v: Vehicle) => v.seats.filter((id, k) => id < 0 && (!air(v) || k > 0)).length;
/** How far a gun seat's Soldier sits out from the hull's centre, so its shot lines leave from that side: 2 m is about the half-width of a transport helicopter's body (a door gun sits at the hull's edge), far enough that the Console's line visibly leaves that side and not so far that a landed gunner stands outside a Capture Point the hull is in. */
export const GUN_OUT_M = 2;
/** The unit vector straight out from the helicopter's `seat` side (1 left, 2 right; the field's y runs up, so left of east is +y), null for the other seats. */
export const beam = (v: Vehicle, seat: number) => (seat === 1 ? { x: -v.fy, y: v.fx } : seat === 2 ? { x: v.fy, y: -v.fx } : null);

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

/** A rifle-model shot's chance on `e` from a vehicle: `hitChance`, less in cover. */
export const rifleChance = (m: Match, e: Soldier) => m.tune.hitChance * (cellAt(m, e.x, e.y) === COVER ? m.tune.coverHitMul : 1);

/** #107: a gun seat's shot (the coax, #108 the MG, #129 a side gun) at `e`: the rifle shot model, the gun's own range and cadence (`SPECS`). */
export function seatGun(m: Match, s: Soldier, v: Vehicle, e: Soldier | null | undefined, shots: Shots): Shot | null {
  const gun = SPECS[v.kind];
  if (!e || e.state !== 'alive' || m.tick < s.nextFire || dist2(v, e) > gun.gunM(m.tune) * gun.gunM(m.tune)) return null;
  return shots.roll(m, s, e, rifleChance(m, e), gun.gunSeconds(m.tune));
}

/** #107: the gunner's coax (#108 the MG): seat 1 fires at the vehicle's infantry target. */
export const coax = (m: Match, s: Soldier, v: Vehicle, shots: Shots) => seatGun(m, s, v, gunner(v) === s.id ? m.soldiers[v.coax] : undefined, shots);

/** The Capture Point `s` is heading for: its own when Detached, else its Squad's; -1 when that is not a Capture Point. */
export const goalOf = (m: Match, sq: Squad, s: Soldier) => (s.detached && s.goal >= 0 ? s.goal : sq.task === 'point' ? sq.goal : -1);

/** #122: `L` is within `boardM` of `v`: a Squad led from there may ride it. */
export const inReach = (m: Match, L: Soldier, v: Vehicle) => dist2(L, v) <= squared(m.tune.boardM);

/** A driver takes the wheel of `v`: it draws its own preference per Capture Point (seeded, kept for the drive), has no goal yet, and starts the wait for others at `wait` (#122: unless a Squad's claim set it). */
export const takeWheel = (m: Match, v: Vehicle, wait: number) =>
  Object.assign(v, { goal: -1, bias: m.points.map(() => (rnd(m) * 2 - 1) * m.tune.tankGoalBias), parked: true, ...(v.claim < 0 && { departAt: wait }) });

/** #129: crew `s` may leave `v`: its stint over, on the helipad, no claimed Squad boarding and no passenger aboard (never a pilotless helicopter with riders). */
export const stintOver = (m: Match, s: Soldier, v: Vehicle) => m.tick >= s.crewUntil && onPad(v) && v.claim < 0 && riders(m, v).every((o) => o.crew);

/** Starts `s`'s crew stint in `seat`, Detached from its Squad's goals; `boarding` is the vehicle it is walking to, or -1. */
export const startCrew = (s: Soldier, crewSeat: number, boarding: number) => Object.assign(s, { crew: true, crewSeat, boarding, detached: true, goal: -1, commitUntil: 0 });

/**
 * The shared passenger rule (#27, #108), at think: a transport empties at its goal (`arrived`: #108 at the end of its drive, #109
 * on its Landing Zone). A passenger, not its driver, also gets out once it has stood still `stillSeconds` (waiting to set off is
 * not standing still), within `dismountM` of its own Capture Point, or (`byDrive`, on the ground) once its drive distance to that
 * point has grown for `awaySeconds`.
 */
export function alight(m: Match, sq: Squad, s: Soldier, v: Vehicle, arrived: () => boolean, byDrive: boolean): boolean {
  const t = m.tune;
  if (v.goal >= 0 && arrived()) return true;
  if (v.seats[0] === s.id) return false;
  if (m.tick - Math.max(v.movedAt, v.departAt) >= t.stillSeconds * t.hz) return true;
  const own = goalOf(m, sq, s);
  const p = m.points[own];
  if (!p) return false;
  if (dist2(v, p) <= squared(t.dismountM)) return true;
  if (!byDrive) return false;
  const d = flowDist(m, driveFlow(m, v.side, own), v);
  if (d === Infinity) return false;
  if (s.away >= 0 && d > s.away) s.awaySince = s.awaySince < 0 ? m.tick : s.awaySince;
  else if (d < s.away) s.awaySince = -1;
  s.away = d;
  return s.awaySince >= 0 && m.tick - s.awaySince >= t.awaySeconds * t.hz;
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
export function descend(m: Match) {
  for (const s of m.soldiers) {
    const c = s.chute;
    if (!c) continue;
    const f = Math.min(1, (m.tick - c.t0) / (c.t1 - c.t0));
    Object.assign(s, { x: c.x0 + (c.x1 - c.x0) * f, y: c.y0 + (c.y1 - c.y0) * f });
    if (f === 1) s.chute = null;
  }
}

/** A Soldier leaves its seat (it died, or came back from the dead). */
export function leave(m: Match, s: Soldier) {
  s.chute = null; // #130: dead or brought back mid-descent
  const v = vehicleOf(m, s.vehicle);
  if (v) v.seats[v.seats.indexOf(s.id)] = -1;
  Object.assign(s, { vehicle: -1, crew: false, crewUntil: -1, crewSeat: -1 });
}
