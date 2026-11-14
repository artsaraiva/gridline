// What damage does (#58 #107): a Soldier shot down is Wounded (`wound`), and dies (`die`: a Ticket, and what the enemy Commander
// earns for it); a vehicle loses hit points (`hurt`), destroyed at 0 with everyone aboard; and a Strike's blast (`blast`) kills,
// Wounds and suppresses by distance, friend or foe: the Barrage (#40) lands one per shell, the Cruise Missile (#99) one, and #107
// a tank's round one. Soldiers aboard a vehicle are out of a blast's reach: the vehicle takes the damage if it is within the kill
// radius (#110: never a jet, #139 nor anything else that flies as high: the Gunship, a drone, the Recon Plane). #183: its own
// module, below combat.ts, the Assets and air-missiles.ts, and importing only the Vehicle body and seats, so that no cycle runs
// through vehicles/.
import type { Match } from './index';
import { resetSoldierAi } from './ai/reset';
import { logDeath } from './ai/routes';
import { dist2 } from './geometry';
import { award } from './score';
import { membersOf, type Soldier } from './state';
import { enemyOf, type SideId, type SimEvent, type Vec2 } from './types';
import { high, live, riders, SPECS, wreck, type Vehicle } from './vehicles/body';
import { bail, leave } from './vehicles/seats';

/** Shot down: bleeding out, not dead. */
export function wound(m: Match, e: Soldier, events: SimEvent[]) {
  const t = m.tune;
  Object.assign(e, { state: 'wounded', suppression: 0, target: -1, reviving: -1, revive: 0, bleed: t.bleedOutSeconds * t.hz, ...resetSoldierAi(m), ammo: e.ammo });
  events.push({ kind: 'wounded', side: e.side, id: e.id, x: e.x, y: e.y });
}

const KILL = { barrage: 'Barrage kill', missile: 'Missile kill', gunship: 'Gunship kill', creep: 'Creeping Barrage kill', drone: 'Drone Strike kill' };

export function die(m: Match, s: Soldier, events: SimEvent[]) {
  leave(m, s); // #107
  s.state = 'dead';
  s.deadAt = m.tick;
  for (const o of membersOf(m, m.squads[s.squad]!)) if (o.reviving === s.id) o.reviving = -1; // a reviver must not keep a job on the dead
  m.tickets[s.side] = Math.max(0, m.tickets[s.side] - 1);
  logDeath(m, { side: s.side, x: s.x, y: s.y, tick: m.tick });
  events.push({ kind: 'death', side: s.side, id: s.id, x: s.x, y: s.y });
  if (s.cause) award(m, enemyOf(s.side), 'artillery', m.tune.scoreArtilleryKill, KILL[s.cause], events); // #55 #99 #101: the enemy Commander's Strike
  if (s.uavAssist) award(m, enemyOf(s.side), 'uav', m.tune.scoreUavAssist, 'UAV assist', events); // #75: and their Scan
  s.cause = null;
  s.uavAssist = false;
  s.uavUntil = -1;
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
    if (live(v) && !high(v) && !(vehicles.foesOnly && v.side === side) && dist2(v, at) <= b.killM * b.killM) hurt(m, v, vehicles.damage(v), side, cause, events);
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
