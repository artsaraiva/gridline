// #101 #139: the bodies Assets fly with no pilot: the Gunship, the Drone Strike's drone and the Recon Plane. Their Asset
// borrows each through the lend interface (core.ts: `borrow` wakes it, `release` puts it to sleep; assets/gunship.ts, drone.ts,
// recon.ts); a Soldier coming back may take a seat in the Gunship on station (`gunshipOnReturn`).
import type { Match } from '../index';
import { dist2 } from '../geometry';
import { rnd } from '../rng';
import { membersOf, type Soldier, type Squad } from '../state';
import type { Vec2 } from '../types';
import { crippled, DORMANT, live, SPECS, type Vehicle } from './body';
import { mount, renew, type VehicleRules } from './core';
import { gunner, goalOf, seatGun, sideGun, startCrew } from './seats';

/** #101: the Gunship's gun seat; the passenger seats follow it. */
export const GUNSHIP_GUN = 1;

/** #101: the Gunship `v` wakes fresh where it waits (its Side's launch point), in the air, heading along (fx, fy). #139: a drone or the Recon Plane wakes at `at`. */
export const wake = (m: Match, v: Vehicle, fx: number, fy: number, at: Vec2 = v.slot) => Object.assign(v, renew(m, v.side, v.kind, v.slot), { x: at.x, y: at.y, fx, fy, airborne: true, speed: SPECS[v.kind].openMps(m.tune) });
/** #101: the Gunship `v` home off the map: asleep again until its next call. #139: so a drone that has hit or been shot down, and the Recon Plane after its pass. */
export const sleep = (v: Vehicle) => Object.assign(v, { deadAt: DORMANT, airborne: false, speed: 0 });

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
export const lent: VehicleRules<'drone'> & VehicleRules<'recon'> = { init: () => ({}), inSky: () => true, hash: () => {} };

/** #101: the Gunship: as a lent body, and its seats for Soldiers coming back. */
export const gunship: VehicleRules<'gunship'> = {
  init: () => ({}),
  seatFor: (_m, v, s) => (s.crew ? GUNSHIP_GUN : v.seats.indexOf(-1, GUNSHIP_GUN + 1)), // its gunner or a passenger; nobody takes the pilot's seat
  onReturn: { order: 3, take: gunshipOnReturn }, // after a jet's pilot and a helicopter's crew
  wantsOut: () => false, // its Asset puts each one out (assets/gunship.ts)
  seatFire: (m, s, v, shots) => seatGun(m, s, v, gunner(v) === s.id ? sideGun(m, v, GUNSHIP_GUN) : undefined, shots), // its one gun is its gun seat's, the left
  inSky: () => true, // all the way (layers/gunship.ts draws it from its Asset)
  hash: () => {}, // its state is its Asset's (assets/gunship.ts hashes it)
};
