// Fire, Wounding, revive and bleed-out, suppression.
import type { Match } from './index';
import { logDeath, resetSoldierAi } from './ai';
import { dist2 } from './geometry';
import { cellAt, COVER, los } from './grid';
import { rnd } from './rng';
import { membersOf, type Soldier } from './state';
import type { SimEvent, Vec2 } from './types';

interface Shot {
  shooter: Soldier;
  target: Soldier | null; // suppressive fire may hit nobody
  hit: boolean;
  damage: number;
  /** Suppressive fire: the aim point, and the enemies close enough to it to be suppressed. */
  at?: Vec2;
  near?: Soldier[];
}

const hitMul = (m: Match, s: Soldier, e: Soldier) =>
  (1 - m.tune.suppressAccuracyLoss * s.suppression) * (cellAt(m, e.x, e.y) === COVER ? m.tune.coverHitMul : 1);

function roll(m: Match, s: Soldier, target: Soldier | null, p: number): Omit<Shot, 'at' | 'near'> {
  const t = m.tune;
  const hit = target !== null && rnd(m) < p;
  const damage = hit ? t.damage[0] + rnd(m) * (t.damage[1] - t.damage[0]) : 0;
  s.nextFire = m.tick + Math.round((t.fireSeconds + rnd(m) * t.fireJitterSeconds) * t.hz);
  s.ammo--;
  return { shooter: s, target, hit, damage };
}

/** Decides a shot from the pre-fire state; every shot of the tick is applied together afterwards. */
function aim(m: Match, s: Soldier): Shot | null {
  const t = m.tune;
  if (s.target < 0 || s.reviving >= 0 || m.tick < s.nextFire || s.ammo <= 0) return null;
  const e = m.soldiers[s.target]!;
  if (dist2(s, e) > t.fireRangeM * t.fireRangeM) return null;
  return roll(m, s, e, t.hitChance * hitMul(m, s, e));
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
    if (c.source !== 'seen' || m.tick - c.tick > t.suppressiveSeconds * t.hz || d2 >= best || d2 < 64) continue;
    best = d2;
    lkp = c;
  }
  if (!lkp || !los(m, s, lkp)) return null;
  const scatter = () => (rnd(m) * 2 - 1) * t.suppressiveScatterM;
  const at = { x: lkp.x + scatter(), y: lkp.y + scatter() };
  const near = m.soldiers.filter((o) => o.side !== s.side && o.state === 'alive' && dist2(o, at) < t.suppressiveRadiusM * t.suppressiveRadiusM);
  let e: Soldier | null = null;
  for (const o of near) if (dist2(o, at) < 16 && (!e || dist2(o, at) < dist2(e, at))) e = o;
  return { ...roll(m, s, e, e ? t.hitChance * t.suppressiveHitMul * hitMul(m, s, e) : 0), at, near };
}

export function fire(m: Match, events: SimEvent[]) {
  const t = m.tune;
  const shots: Shot[] = [];
  for (const s of m.soldiers) {
    if (s.state !== 'alive') continue;
    const shot = aim(m, s) ?? suppressive(m, s);
    if (shot) shots.push(shot);
  }
  for (const { shooter, target: e, hit, damage, at, near } of shots) {
    if (e) e.hp -= damage;
    if (at) {
      for (const o of near!) o.suppression = Math.min(1, o.suppression + t.suppressPerShot * t.suppressiveSuppressMul);
      events.push({ kind: 'suppressive', side: shooter.side, from: shooter.id, x: at.x, y: at.y, hit });
      continue;
    }
    e!.suppression = Math.min(1, e!.suppression + t.suppressPerShot);
    events.push({ kind: 'shot', side: shooter.side, from: shooter.id, to: e!.id, hit });
  }
  for (const { target: e } of shots) {
    if (!e || e.state !== 'alive' || e.hp > 0) continue;
    Object.assign(e, { state: 'wounded', suppression: 0, target: -1, reviving: -1, revive: 0, bleed: t.bleedOutSeconds * t.hz, ...resetSoldierAi(m), ammo: e.ammo });
    events.push({ kind: 'wounded', side: e.side, id: e.id, x: e.x, y: e.y });
  }
}

function die(m: Match, s: Soldier, events: SimEvent[]) {
  s.state = 'dead';
  s.deadAt = m.tick;
  m.tickets[s.side] = Math.max(0, m.tickets[s.side] - 1);
  logDeath(m, { side: s.side, x: s.x, y: s.y, tick: m.tick });
  events.push({ kind: 'death', side: s.side, id: s.id, x: s.x, y: s.y });
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
        if (s.state !== 'alive' || s.reviving >= 0 || s.suppression > t.pinnedAt || dist2(s, w) > best) continue;
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
      Object.assign(w, { state: 'alive', hp: t.reviveHp, nextFire: m.tick });
      events.push({ kind: 'revived', side: w.side, id: w.id, by: r.id });
    }
  }
}

export function suppressionDecay(m: Match) {
  const t = m.tune;
  for (const s of m.soldiers) s.suppression = Math.max(0, s.suppression - t.suppressDecayPerSecond / t.hz);
}
