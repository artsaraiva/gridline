// Fire, Wounding, revive and bleed-out, suppression; a death settles what the enemy Commander's Assets earn (#72 #75).
// #107: Soldiers aboard a vehicle fire only its guns (each seat's by its kind's `seatFire`, handed the shot model here; the main
// gun in vehicles/core.ts) and take no fire; a Launcher's rockets hit vehicles. #108: rifles hit a jeep like a Soldier in the open.
// #110: lock-on missiles in air-missiles.ts.
import type { Match } from './index';
import { logDeath, resetSoldierAi } from './ai';
import { isDummy } from './assets/crate';
import { dist2, inHq } from './geometry';
import { cellAt, COVER, wallLos } from './grid';
import { flyMissiles } from './air-missiles';
import { rnd } from './rng';
import { award } from './score';
import { membersOf, vehicleOf, type Soldier } from './state';
import { enemyOf, type SimEvent, type Vec2 } from './types';
import { hurt, isLauncher, leave, lockMissiles, mainGuns, rocketTarget, seatFire, type Shot, type Shots, type Vehicle } from './vehicles';

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
 * in range and line of sight. #136: or, with none and its Squad taking fire, at the nearest Mark, in range and line of sight. #143: or, with neither
 * and itself suppressed, at the nearest spot it heard fire from. Scattered round it; enemies near the aim point are suppressed less than by aimed fire, and the
 * nearest is hit at a fraction of the chance. Flankers and Soldiers short of ammo hold it.
 */
function suppressive(m: Match, s: Soldier): Shot | null {
  const t = m.tune;
  if (s.target >= 0 || s.reviving >= 0 || m.tick < s.nextFire || s.role === 'flank' || s.ammo < t.suppressiveMinAmmo) return null;
  let lkp: Vec2 | null = null;
  let best = t.fireRangeM * t.fireRangeM;
  const sq = m.squads[s.squad]!;
  for (const c of sq.memory) {
    const d2 = dist2(c, s);
    if (c.source !== 'seen' || !m.soldiers[c.id] || m.tick - c.tick > t.suppressiveSeconds * t.hz || d2 >= best || d2 < 64) continue; // #107: never at a vehicle
    best = d2;
    lkp = c;
  }
  // #136: taking fire with no such position, it fires at the nearest of its Side's Marks instead: a wrong Mark costs the ammunition
  if (!lkp && m.tick - sq.lastHit <= t.takingFireSeconds * t.hz)
    for (const k of m.marks.of[s.side]) {
      const d2 = dist2(k, s);
      if (d2 >= best || d2 < 64) continue;
      best = d2;
      lkp = k;
    }
  // #143: suppressed with neither, at the nearest Feint dummy it hears going off. Only a dummy: its spec took this for the rule on all heard fire, but
  // real fire heard from an unseen shooter draws none, so that a Mark is still the one way to send a Squad's fire at an enemy it cannot see (#136)
  if (!lkp && s.suppression > t.suppressedAt)
    for (const c of sq.memory) {
      const d2 = dist2(c, s);
      if (c.source !== 'heard' || !isDummy(m, c.id) || m.tick - c.tick > t.suppressiveSeconds * t.hz || d2 >= best || d2 < 64) continue;
      best = d2;
      lkp = c;
    }
  if (!lkp || !wallLos(m, s, lkp)) return null; // #138: suppressive fire has no target, so it crosses smoke
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

/** #183: the shot model a vehicle's seat fires by (vehicles/core.ts `seatFire`). */
const SHOTS: Shots = { roll, rake };

export function fire(m: Match, events: SimEvent[]) {
  const t = m.tune;
  const shots: Shot[] = [];
  for (const s of m.soldiers) {
    if (s.state !== 'alive' || s.chute) continue; // #130: never fires on a parachute
    const v = vehicleOf(m, s.vehicle);
    if (inHq(m, s.side, v ?? s)) continue; // nobody fires out of its own HQ: the enemy can't fire back into it
    const shot = v ? seatFire(m, s, v, SHOTS) : (rocket(m, s) ?? aim(m, s) ?? suppressive(m, s)); // #107: aboard, it fires its seat's gun
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
  lockMissiles(m); // #110
  flyMissiles(m, events);
}

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
