// Fire, Wounding, revive and bleed-out, suppression.
import type { Match } from './index';
import { dist2 } from './geometry';
import { cellAt, COVER } from './grid';
import { rnd } from './rng';
import { membersOf, type Soldier } from './state';
import type { SimEvent } from './types';

interface Shot {
  shooter: Soldier;
  target: Soldier;
  hit: boolean;
  damage: number;
}

/** Decides a shot from the pre-fire state; every shot of the tick is applied together afterwards. */
function aim(m: Match, s: Soldier): Shot | null {
  const t = m.tune;
  if (s.target < 0 || s.reviving >= 0 || m.tick < s.nextFire) return null;
  const e = m.soldiers[s.target]!;
  if (dist2(s, e) > t.fireRangeM * t.fireRangeM) return null;
  const p = t.hitChance * (1 - t.suppressAccuracyLoss * s.suppression) * (cellAt(m, e.x, e.y) === COVER ? t.coverHitMul : 1);
  const hit = rnd(m) < p;
  const damage = hit ? t.damage[0] + rnd(m) * (t.damage[1] - t.damage[0]) : 0;
  s.nextFire = m.tick + Math.round((t.fireSeconds + rnd(m) * t.fireJitterSeconds) * t.hz);
  return { shooter: s, target: e, hit, damage };
}

export function fire(m: Match, events: SimEvent[]) {
  const shots: Shot[] = [];
  for (const s of m.soldiers) {
    if (s.state !== 'alive') continue;
    const shot = aim(m, s);
    if (shot) shots.push(shot);
  }
  for (const { shooter, target: e, hit, damage } of shots) {
    e.hp -= damage;
    e.suppression = Math.min(1, e.suppression + m.tune.suppressPerShot);
    events.push({ kind: 'shot', side: shooter.side, from: shooter.id, to: e.id, hit });
  }
  for (const { target: e } of shots) {
    if (e.state !== 'alive' || e.hp > 0) continue;
    Object.assign(e, { state: 'wounded', suppression: 0, target: -1, reviving: -1, revive: 0, bleed: m.tune.bleedOutSeconds * m.tune.hz });
    events.push({ kind: 'wounded', side: e.side, id: e.id, x: e.x, y: e.y });
  }
}

function die(m: Match, s: Soldier, events: SimEvent[]) {
  s.state = 'dead';
  s.deadAt = m.tick;
  m.tickets[s.side] = Math.max(0, m.tickets[s.side] - 1);
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
