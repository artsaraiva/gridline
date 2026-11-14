// #101 #139: the bodies Assets fly with no pilot: the Gunship, the Drone Strike's drone and the Recon Plane. #183: the lend
// interface, the one way an Asset changes the aircraft it flies (assets/gunship.ts, drone.ts, recon.ts): it borrows its Side's
// body as it is called (`borrow` wakes it), steers it each tick (`steer`), learns when it is lost (`lost`) and releases it home,
// asleep until the next call (`release`). Nothing else wakes a lent body or puts it to sleep. A Soldier coming back may take a
// seat in the Gunship on station (`gunshipOnReturn`).
import type { Match } from '../index';
import { dist2 } from '../geometry';
import { rnd } from '../rng';
import { membersOf, type Soldier, type Squad } from '../state';
import type { SideId, Vec2 } from '../types';
import { crippled, DORMANT, live, SPECS, type LentKind, type Vehicle } from './body';
import { mount, renew, type VehicleRules } from './core';
import { gunner, goalOf, seatGun, sideGun, startCrew } from './seats';

/** #101: the Gunship's gun seat; the passenger seats follow it. */
export const GUNSHIP_GUN = 1;

/** #101: its Side's Gunship wakes fresh where it waits (its Side's launch point, `at`), in the air, heading along `heading`; #139 so does a drone or the Recon Plane. */
export function borrow(m: Match, side: SideId, kind: LentKind, at: Vec2, heading: { fx: number; fy: number }): Vehicle {
  const v = m.vehicles.find((o) => o.kind === kind && o.side === side)!;
  return Object.assign(v, renew(m, side, kind, v.slot), { x: at.x, y: at.y, fx: heading.fx, fy: heading.fy, airborne: true, speed: SPECS[kind].openMps(m.tune) });
}
/** Its Asset's flight this tick: `v` is at `at` (with `heading`, when it turns). */
export const steer = (m: Match, v: Vehicle, at: Vec2, heading?: { fx: number; fy: number }) => void Object.assign(v, { x: at.x, y: at.y, ...heading, movedAt: m.tick });
/** It was shot down: `hurt` left a Wreck, or none for a small aircraft. */
export const lost = (v: Vehicle) => !live(v);
/** #101: the Gunship home off the map (or fallen), #139 a drone that has hit or been shot down, the Recon Plane after its pass: asleep until its Asset's next call. */
export const release = (v: Vehicle) => void Object.assign(v, { deadAt: DORMANT, airborne: false, speed: 0 });

/**
 * #101: a Soldier coming back takes a seat in its Side's Gunship on station (`v`, the body its Asset flies: respawn.ts finds it):
 * by `crewSpawnChance` its empty gun seat (as a helicopter's crew: never the Squad Leader, none while a member of its Squad crews),
 * else by `paradropChance` a free passenger seat when the aircraft is nearer the Soldier's goal than where it came back (it jumps
 * as it passes the goal: assets/gunship.ts). True when it did.
 */
export function gunshipOnReturn(m: Match, sq: Squad, s: Soldier, v?: Vehicle): boolean {
  if (!v || !live(v) || crippled(m, v)) return false;
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

/** #139: a drone or the Recon Plane: nobody aboard, and it moves only as its Asset flies it; in both Sides' sky all the way. */
export const lent: VehicleRules<'drone'> & VehicleRules<'recon'> = { init: () => ({}), inSky: () => true };

/** #101: the Gunship: as a lent body, and its seats for Soldiers coming back. */
export const gunship: VehicleRules<'gunship'> = {
  init: () => ({}),
  seatFor: (_m, v, s) => (s.crew ? GUNSHIP_GUN : v.seats.indexOf(-1, GUNSHIP_GUN + 1)), // its gunner or a passenger; nobody takes the pilot's seat
  onReturn: { order: 3, take: gunshipOnReturn }, // after a jet's pilot and a helicopter's crew
  wantsOut: () => false, // its Asset puts each one out (assets/gunship.ts)
  seatFire: (m, s, v, shots) => seatGun(m, s, v, gunner(v) === s.id ? sideGun(m, v, GUNSHIP_GUN) : undefined, shots), // its one gun is its gun seat's, the left
  inSky: () => true, // all the way (layers/gunship.ts draws it from its Asset)
};
