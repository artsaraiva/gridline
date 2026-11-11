// Fire, Wounding, revive and bleed-out, suppression; a death settles what the enemy Commander's Assets earn (#72 #75).
// #107: Soldiers aboard a vehicle fire only its guns (the coax here, the main gun in vehicles.ts) and take no fire; a
// Launcher's rockets hit vehicles. #108: rifles hit a jeep like a Soldier in the open; its gunner fires the MG as the coax.
// #110: a jet's pilot fires its cannon as the coax, an AA's occupant its gun in bursts; lock-on missiles in air-missiles.ts.
// #101: the Gunship's gunner fires its left side gun as a helicopter's.
import type { Match } from './index';
import { logDeath, resetSoldierAi } from './ai';
import { dist2 } from './geometry';
import { cellAt, COVER, los } from './grid';
import { flyMissiles, launchMissiles } from './air-missiles';
import { between, rnd } from './rng';
import { award } from './score';
import { membersOf, ticksOf, vehicleOf, type Soldier } from './state';
import { enemyOf, type SimEvent, type Vec2 } from './types';
import { jetTarget } from './jet';
import { gunner, hurt, isLauncher, leave, mainGuns, rocketTarget, sideGun, specOf, type Vehicle } from './vehicles';

interface Shot {
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

const hitMul = (m: Match, s: Soldier, e: Soldier) =>
  (1 - m.tune.suppressAccuracyLoss * s.suppression) * (cellAt(m, e.x, e.y) === COVER ? m.tune.coverHitMul : 1);

function roll(m: Match, s: Soldier, target: Soldier | null, p: number, every = m.tune.fireSeconds, vehicle?: Vehicle): Omit<Shot, 'at' | 'near'> {
  const t = m.tune;
  const hit = (target !== null || !!vehicle) && rnd(m) < p;
  const damage = hit ? t.damage[0] + rnd(m) * (t.damage[1] - t.damage[0]) : 0;
  s.nextFire = m.tick + Math.round((every + rnd(m) * t.fireJitterSeconds) * t.hz);
  s.ammo--;
  return { shooter: s, target, hit, damage, ...(vehicle && { vehicle }) };
}

/** #107: a Launcher with rockets left fires one at the nearest enemy vehicle in reach, ahead of its rifle. */
function rocket(m: Match, s: Soldier): Shot | null {
  const t = m.tune;
  if (s.rockets <= 0 || s.reviving >= 0 || m.tick < s.nextFire || !isLauncher(m, s)) return null;
  const v = rocketTarget(m, s);
  if (!v) return null;
  s.rockets--;
  s.nextFire = m.tick + Math.round(t.rocketSeconds * t.hz);
  return { shooter: s, target: null, hit: true, damage: t.rocketDamage, vehicle: v };
}

/** #107: the gunner aboard fires the coax (#108: a jeep's MG, #109 a helicopter's side gun) at the vehicle's infantry target: the rifle shot model, faster and longer. */
function coax(m: Match, s: Soldier, v: Vehicle): Shot | null {
  const t = m.tune;
  if (v.kind === 'jet') return cannon(m, s, v);
  if (v.kind === 'aa') return aaRound(m, s, v);
  const gun = specOf(t, v.kind);
  const seat = v.seats.indexOf(s.id);
  const e = v.kind === 'helicopter' || (v.kind === 'gunship' && gunner(v) === s.id) ? sideGun(m, v, seat) : gunner(v) === s.id ? m.soldiers[v.coax] : undefined; // #129: a helicopter's guns are its side seats; #101 the Gunship's one gun is seat 1's, its left
  if (!e || e.state !== 'alive' || m.tick < s.nextFire || dist2(v, e) > gun.gunM * gun.gunM) return null;
  return roll(m, s, e, t.hitChance * (cellAt(m, e.x, e.y) === COVER ? t.coverHitMul : 1), gun.gunSeconds);
}

/**
 * #110: a jet's cannon in its strip, at what the Side knows (`jetTarget`): the rifle shot model, `jetVsVehicleDamage` a hit on a
 * vehicle. With no Contact in the strip it rakes its mark's last known spot instead, as suppressive fire scattered `jetStripM`.
 */
function cannon(m: Match, s: Soldier, v: Vehicle): Shot | null {
  const t = m.tune;
  if (m.tick < s.nextFire) return null;
  const e = jetTarget(m, v);
  if (!e) return v.sortie === 'inbound' && v.prey >= 0 && dist2(v, v.spot!) <= t.jetFireM * t.jetFireM ? rake(m, s, v.spot!, t.jetStripM, t.jetFireSeconds) : null;
  if ('kind' in e) {
    const shot = roll(m, s, null, t.hitChance, t.jetFireSeconds, e);
    return { ...shot, damage: shot.hit ? (e.kind === 'jet' ? t.jetVsJetDamage : t.jetVsVehicleDamage) : 0 };
  }
  return roll(m, s, e, t.hitChance * (cellAt(m, e.x, e.y) === COVER ? t.coverHitMul : 1), t.jetFireSeconds);
}

/**
 * #110: an AA's gun, at its target (air first, else a jeep) or else its infantry target: bursts of `aaBurstSeconds` (seeded) of a
 * round every `aaFireSeconds`, each followed by an `aaPauseSeconds` pause (seeded); a fresh target gets a fresh burst. A round on a
 * vehicle hits with `aaHitChance` for `aaRoundDamage`; on a Soldier it is the rifle shot model.
 */
function aaRound(m: Match, s: Soldier, v: Vehicle): Shot | null {
  const t = m.tune;
  const e = vehicleOf(m, v.target) ?? m.soldiers[v.coax];
  if (!e) {
    v.until = -1;
    return null;
  }
  if (m.tick < s.nextFire) return null;
  if (v.until < 0) v.until = m.tick + ticksOf(t, between(m, t.aaBurstSeconds));
  else if (m.tick >= v.until) {
    s.nextFire = m.tick + ticksOf(t, between(m, t.aaPauseSeconds));
    v.until = -1;
    return null;
  }
  const shot = 'kind' in e ? roll(m, s, null, t.aaHitChance, t.aaFireSeconds, e) : roll(m, s, e, t.hitChance * (cellAt(m, e.x, e.y) === COVER ? t.coverHitMul : 1), t.aaFireSeconds);
  s.nextFire = m.tick + ticksOf(t, t.aaFireSeconds); // a steady cadence within the burst, not the rifle's jitter
  if ('kind' in e) shot.damage = shot.hit ? t.aaRoundDamage : 0;
  return shot;
}

/** Decides a shot from the pre-fire state; every shot of the tick is applied together afterwards. */
function aim(m: Match, s: Soldier): Shot | null {
  const t = m.tune;
  if (s.target < 0 || s.reviving >= 0 || m.tick < s.nextFire || s.ammo <= 0) return null;
  const jeep = vehicleOf(m, s.target); // #108: no cover for a jeep
  const e = m.soldiers[s.target] ?? jeep!;
  if (dist2(s, e) > t.fireRangeM * t.fireRangeM) return null;
  if (jeep) return roll(m, s, null, t.hitChance * (1 - t.suppressAccuracyLoss * s.suppression), t.fireSeconds, jeep);
  return roll(m, s, e as Soldier, t.hitChance * hitMul(m, s, e as Soldier));
}

/**
 * Suppressive fire, with no enemy in view: at the nearest Last Known Position (seen, not heard) its Squad has from the last `suppressiveSeconds`,
 * in range and line of sight. Scattered round it; enemies near the aim point are suppressed less than by aimed fire, and the
 * nearest is hit at a fraction of the chance. Flankers and Soldiers short of ammo hold it.
 */
function suppressive(m: Match, s: Soldier): Shot | null {
  const t = m.tune;
  if (s.target >= 0 || s.reviving >= 0 || m.tick < s.nextFire || s.role === 'flank' || s.ammo < t.suppressiveMinAmmo) return null;
  let lkp: Vec2 | null = null;
  let best = t.fireRangeM * t.fireRangeM;
  for (const c of m.squads[s.squad]!.memory) {
    const d2 = dist2(c, s);
    if (c.source !== 'seen' || !m.soldiers[c.id] || m.tick - c.tick > t.suppressiveSeconds * t.hz || d2 >= best || d2 < 64) continue; // #107: never at a vehicle
    best = d2;
    lkp = c;
  }
  if (!lkp || !los(m, s, lkp)) return null;
  return rake(m, s, lkp, t.suppressiveScatterM, t.fireSeconds);
}

/** Suppressive fire scattered up to `scatterM` round `aim`: the enemies near the aim point are suppressed, the nearest within 4 m hit at a fraction of the chance. */
function rake(m: Match, s: Soldier, aim: Vec2, scatterM: number, every: number): Shot {
  const t = m.tune;
  const scatter = () => (rnd(m) * 2 - 1) * scatterM;
  const at = { x: aim.x + scatter(), y: aim.y + scatter() };
  const near = m.soldiers.filter((o) => o.side !== s.side && o.state === 'alive' && o.vehicle < 0 && dist2(o, at) < t.suppressiveRadiusM * t.suppressiveRadiusM);
  let e: Soldier | null = null;
  for (const o of near) if (dist2(o, at) < 16 && (!e || dist2(o, at) < dist2(e, at))) e = o;
  return { ...roll(m, s, e, e ? t.hitChance * t.suppressiveHitMul * hitMul(m, s, e) : 0, every), at, near };
}

export function fire(m: Match, events: SimEvent[]) {
  const t = m.tune;
  const shots: Shot[] = [];
  for (const s of m.soldiers) {
    if (s.state !== 'alive' || s.chute) continue; // #130: never fires on a parachute
    const v = vehicleOf(m, s.vehicle);
    const shot = v ? coax(m, s, v) : (rocket(m, s) ?? aim(m, s) ?? suppressive(m, s));
    if (shot) shots.push(shot);
  }
  for (const { shooter, target: e, hit, damage, at, near, vehicle } of shots) {
    if (vehicle) {
      if (hit) hurt(m, vehicle, damage, shooter.side, null, events);
      events.push({ kind: 'shot', side: shooter.side, from: shooter.id, to: vehicle.id, hit });
      continue;
    }
    if (e) e.hp -= damage;
    if (at) {
      for (const o of near!) {
        o.suppression = Math.min(1, o.suppression + t.suppressPerShot * t.suppressiveSuppressMul);
        m.squads[o.squad]!.lastHit = m.tick;
      }
      events.push({ kind: 'suppressive', side: shooter.side, from: shooter.id, x: at.x, y: at.y, hit });
      continue;
    }
    e!.suppression = Math.min(1, e!.suppression + t.suppressPerShot);
    m.squads[e!.squad]!.lastHit = m.tick;
    events.push({ kind: 'shot', side: shooter.side, from: shooter.id, to: e!.id, hit });
  }
  for (const { target: e } of shots) {
    if (!e || e.state !== 'alive' || e.hp > 0) continue;
    e.uavAssist ||= m.tick <= e.uavUntil; // #75: the downing shot fixes whether the UAV gets the assist
    wound(m, e, events);
  }
  mainGuns(m, events); // #107
  launchMissiles(m); // #110
  flyMissiles(m, events);
}

/** Shot down: bleeding out, not dead. */
export function wound(m: Match, e: Soldier, events: SimEvent[]) {
  const t = m.tune;
  Object.assign(e, { state: 'wounded', suppression: 0, target: -1, reviving: -1, revive: 0, bleed: t.bleedOutSeconds * t.hz, ...resetSoldierAi(m), ammo: e.ammo });
  events.push({ kind: 'wounded', side: e.side, id: e.id, x: e.x, y: e.y });
}

const KILL = { barrage: 'Barrage kill', missile: 'Missile kill', gunship: 'Gunship kill' };

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
 * Each Wounded Soldier gets the nearest unpinned squad mate in range as their reviver. The bleed-out clock runs
 * while the reviver runs over and pauses while they work beside the Wounded (so a mate up to about 38 m away
 * makes it); a reviver that is pinned or goes down drops the job.
 */
export function casualties(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const w of m.soldiers) {
    if (w.state !== 'wounded') continue;
    const mates = membersOf(m, m.squads[w.squad]!);
    let r = mates.find((s) => s.reviving === w.id);
    if (r && r.suppression > t.pinnedAt) {
      r.reviving = -1;
      r = undefined;
    }
    if (!r) {
      let best = t.reviveRangeM * t.reviveRangeM;
      for (const s of mates) {
        if (s.state !== 'alive' || s.vehicle >= 0 || s.reviving >= 0 || s.suppression > t.pinnedAt || dist2(s, w) > best) continue; // #107: nobody aboard revives
        best = dist2(s, w);
        r = s;
      }
      if (r) r.reviving = w.id;
    }
    if (!r || dist2(r, w) > t.reviveReachM * t.reviveReachM) {
      if (--w.bleed > 0) continue;
      if (r) r.reviving = -1;
      die(m, w, events);
    } else if (++w.revive >= t.reviveSeconds * t.hz) {
      r.reviving = -1;
      Object.assign(w, { state: 'alive', hp: t.reviveHp, nextFire: m.tick, cause: null, uavAssist: false }); // #55 #75: a Revive clears what Wounded them
      events.push({ kind: 'revived', side: w.side, id: w.id, by: r.id });
    }
  }
}

export function suppressionDecay(m: Match) {
  const t = m.tune;
  for (const s of m.soldiers) s.suppression = Math.max(0, s.suppression - t.suppressDecayPerSecond / t.hz);
}
