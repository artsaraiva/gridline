// #101 #139: the bodies Assets fly with no pilot: the Gunship, the Drone Strike's drone and the Recon Plane. Their Asset wakes
// each and puts it to sleep (assets/gunship.ts, drone.ts, recon.ts); a Soldier coming back may take a Gunship seat
// (`gunshipOnReturn`).
import type { Match } from '../index';
import { dist2 } from '../geometry';
import { rnd } from '../rng';
import { membersOf, vehicleOf, type Soldier, type Squad } from '../state';
import type { Vec2 } from '../types';
import { crippled, DORMANT, fresh, live, specOf, type Vehicle } from './body';
import { mount } from './core';
import { goalOf, startCrew } from './seats';

/** #101: the Gunship's gun seat; the passenger seats follow it. */
export const GUNSHIP_GUN = 1;

/** #101: the Gunship `v` wakes fresh where it waits (its Side's launch point), in the air, heading along (fx, fy). #139: a drone or the Recon Plane wakes at `at`. */
export const wake = (m: Match, v: Vehicle, fx: number, fy: number, at: Vec2 = v.slot) => Object.assign(v, fresh(m, v.side, v.kind, v.slot), { x: at.x, y: at.y, fx, fy, airborne: true, speed: specOf(m.tune, v.kind).openMps });
/** #101: the Gunship `v` home off the map: asleep again until its next call. #139: so a drone that has hit or been shot down, and the Recon Plane after its pass. */
export const sleep = (v: Vehicle) => Object.assign(v, { deadAt: DORMANT, airborne: false, speed: 0 });

/**
 * #101: a Soldier coming back takes a seat in its Side's Gunship on station: by `crewSpawnChance` its empty gun seat (as a
 * helicopter's crew: never the Squad Leader, none while a member of its Squad crews), else by `paradropChance` a free passenger
 * seat when the aircraft is nearer the Soldier's goal than where it came back (it jumps as it passes the goal: assets/gunship.ts). True when it did.
 */
export function gunshipOnReturn(m: Match, sq: Squad, s: Soldier): boolean {
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
