// What every Strike's blast does to the Soldiers round it (#58): kills, Wounds and suppresses by distance, friend or foe.
// The Barrage (#40) lands one per shell, the Cruise Missile (#99) one, and #107 a tank's main gun one per round.
// Soldiers aboard a vehicle are out of its reach: the vehicle takes the damage if it is within the kill radius.
import { die, wound } from '../combat';
import { dist2 } from '../geometry';
import type { SideId, SimEvent, Vec2 } from '../types';
import type { Match } from '../index';
import type { Soldier } from '../state';
import { hurt, live, type Vehicle } from '../vehicles';

export interface Blast {
  killM: number;
  woundM: number;
  suppressM: number;
  /** Suppression (0..1) it leaves on the living in the suppress ring. */
  suppression: number;
}

/**
 * One blast fired by `side` at `at`: nobody dodges (a Squad in the ring is the Commander's mistake). `cause` is the Strike
 * the enemy Commander is paid for, null for a main gun. `vehicles`: what it does to a vehicle within its kill radius.
 */
export function blast(m: Match, side: SideId, at: Vec2, b: Blast, cause: Soldier['cause'], events: SimEvent[], vehicles: { damage: (v: Vehicle) => number; foesOnly?: boolean }) {
  for (const v of m.vehicles)
    if (live(v) && !(vehicles.foesOnly && v.side === side) && dist2(v, at) <= b.killM * b.killM) hurt(m, v, vehicles.damage(v), side, cause, events);
  for (const s of m.soldiers) {
    if (s.state === 'dead' || s.vehicle >= 0) continue;
    const d2 = dist2(s, at);
    const kills = d2 <= b.killM * b.killM;
    // #55: an enemy it kills, whatever its state, or Wounds scores for the caller; one already Wounded by rifle fire is not its
    if (cause && s.side !== side && (kills || (s.state === 'alive' && d2 <= b.woundM * b.woundM))) {
      s.cause = cause;
      if (s.state === 'alive') s.uavAssist ||= m.tick <= s.uavUntil; // #75: and the UAV that found it, if it did; fixed by the first downing hit
    }
    if (kills) {
      if (s.side === side) s.cause = null; // its own Side's strike: the enemy Commander is not paid for a friendly-fire death
      Object.assign(s, { suppression: 0, target: -1, reviving: -1 }); // a killed reviver must not keep a job
      die(m, s, events);
    } else if (d2 <= b.woundM * b.woundM && s.state === 'alive') wound(m, s, events);
    else if (d2 <= b.suppressM * b.suppressM && s.state === 'alive') s.suppression = Math.max(s.suppression, b.suppression);
  }
}
