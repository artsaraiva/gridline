// Fire, revive and bleed-out, suppression (#72 #75); Wounding and death are damage.ts's. #107: Soldiers aboard a vehicle fire only its
// guns (each seat's by its kind's `seatFire`, handed the shot model here; a kind's own gun in the gun pass, vehicles/core.ts `guns`)
// and take no fire; the rounds land here; a Launcher's rockets hit vehicles. #108: rifles hit a jeep like a Soldier in the open.
// #110: lock-on missiles in air-missiles.ts.
import type { Match } from './index';
import { isDummy } from './assets/crate';
import { dist2, inHq } from './geometry';
import { cellAt, COVER, wallLos } from './grid';
import { flyMissiles } from './air-missiles';
import { rnd } from './rng';
import { blast, die, hurt, wound } from './damage';
import { membersOf, vehicleOf, type Soldier } from './state';
import type { SimEvent, Vec2 } from './types';
import { guns, isLauncher, lockMissiles, rocketTarget, seatFire, SPECS, type Shot, type Shots, type Vehicle } from './vehicles';

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
  guns(m); // #107: the gun pass
  land(m, events);
  lockMissiles(m); // #110
  flyMissiles(m, events);
}

/**
 * #107: every round due lands, a Strike-shaped impact hitting the enemy's vehicles in its kill radius: `tankVsVehicleDamage` on armour
 * (a tank, #110 an AA), anything lighter destroyed. No Commander is paid for what it kills. #110: a jet's bombs land the same way,
 * each a blast of its own (`jetBomb*`), friend or foe as a Strike's, never on the air.
 */
function land(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const v of m.vehicles)
    for (const r of v.rounds.filter((r) => r.land <= m.tick)) {
      events.push({ kind: 'impact', side: v.side, x: r.x, y: r.y, asset: r.bomb ? 'bomb' : 'tank', from: v.id });
      if (r.bomb) blast(m, v.side, r, { killM: t.jetBombKillM, woundM: t.jetBombWoundM, suppressM: t.jetBombSuppressM, suppression: 1 }, null, events, { damage: (u) => (u.airborne ? 0 : t.jetBombVehicleDamage) });
      else blast(m, v.side, r, { killM: t.tankKillM, woundM: t.tankWoundM, suppressM: t.tankSuppressM, suppression: t.tankSuppression }, null, events, { damage: (u) => (SPECS[u.kind].armour ? t.tankVsVehicleDamage : Infinity), foesOnly: true });
      v.rounds.splice(v.rounds.indexOf(r), 1);
    }
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
