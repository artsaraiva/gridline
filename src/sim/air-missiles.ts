// #110: lock-on missiles, air only: the AA's at a helicopter or a jet, and a jet's at the enemy jet in a dogfight. A launcher
// locks on a target it holds (`lockOn`), fires one once the lock is done, then reloads; the missile turns after its target, and
// close on it hits with a seeded chance or flies on past until it is spent (`flyMissiles`).
import type { Match } from './index';
import { dist2 } from './geometry';
import { turnToward } from './momentum';
import { rnd } from './rng';
import { ticksOf, vehicleOf, type Mix } from './state';
import type { SimEvent } from './types';
import { hurt, live, type Vehicle } from './vehicles';

export interface AirMissile {
  x: number;
  y: number;
  fx: number; // unit heading
  fy: number;
  prey: number; // the vehicle id it was fired at
  launch: number; // tick
  missed: boolean; // its fuse passed the target by: it flies straight on until spent
}

/** Within this of its target a missile's fuse decides, a hit or a miss: about a step at its speed. */
const FUSE_M = 6;

/**
 * `v` holds `prey` (a vehicle id, -1 = none) in its sights this tick (its kind's `lock`, in the lock pass: vehicles/core.ts `lockMissiles`). A new one starts a lock of `lockSeconds` (kept on `laid`
 * and `nextFire`, as a tank lays its main gun); once the lock is done and it has reloaded, one missile leaves at it, and the
 * next may `reloadSeconds` on.
 */
export function lockOn(m: Match, v: Vehicle, prey: number, lockSeconds: number, reloadSeconds: number) {
  if (prey < 0) {
    v.laid = -1;
    return;
  }
  if (prey !== v.laid) {
    v.laid = prey;
    v.nextFire = Math.max(v.nextFire, m.tick + ticksOf(m.tune, lockSeconds));
  }
  if (m.tick < v.nextFire) return;
  const e = vehicleOf(m, prey)!;
  const d = Math.sqrt(dist2(v, e)) || 1;
  v.missiles.push({ x: v.x, y: v.y, fx: (e.x - v.x) / d, fy: (e.y - v.y) / d, prey, launch: m.tick, missed: false });
  v.nextFire = m.tick + ticksOf(m.tune, reloadSeconds);
}

/** One tick of every missile in flight (a destroyed launcher's fly on): it turns after its live target and, at its fuse, hits or misses. */
export function flyMissiles(m: Match, events: SimEvent[]) {
  const t = m.tune;
  const step = t.airMissileMps / t.hz;
  for (const v of m.vehicles)
    v.missiles = v.missiles.filter((s) => {
      const e = vehicleOf(m, s.prey)!;
      if (!s.missed && live(e)) {
        const d = Math.sqrt(dist2(s, e)) || 1e-6;
        if (d <= step + FUSE_M) {
          if (rnd(m) < (e.kind === 'jet' ? t.airMissileVsJetHitChance : t.airMissileHitChance)) {
            hurt(m, e, t.airMissileDamage, v.side, null, events);
            return false;
          }
          s.missed = true;
        } else Object.assign(s, turnToward(s.fx, s.fy, (e.x - s.x) / d, (e.y - s.y) / d, t.airMissileTurnDegPerS, t.hz));
      }
      Object.assign(s, { x: s.x + s.fx * step, y: s.y + s.fy * step });
      return m.tick - s.launch < ticksOf(t, t.airMissileSeconds);
    });
}

export function hashMissiles(v: Vehicle, mix: Mix) {
  mix(v.missiles.length);
  for (const s of v.missiles) for (const n of [Math.round(s.x * 1000), Math.round(s.y * 1000), Math.round(s.fx * 1000), Math.round(s.fy * 1000), s.prey, s.launch, +s.missed]) mix(n);
}
