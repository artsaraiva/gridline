// Smoke on the ground (#138): the disc each Smoke Screen shell leaves, and the ground sight it blocks. A module of its own, clear
// of assets/core.ts, so grid.ts can read it for `los`; assets/smoke.ts is the Asset that lays the discs.
import { segDist2 } from './geometry';
import type { Match } from './index';
import type { Tune, Vec2 } from './types';

/** How long a disc lasts from its landing, in seconds. */
export const smokeLife = (t: Tune) => t.smokeBloomSeconds + t.smokeHoldSeconds + t.smokeThinSeconds;

/** A disc `age` ticks after its shell landed: `r`, its radius in metres (0 before it lands and once it is gone), and `density`, 1 until it thins. */
export function smokeDisc(t: Tune, age: number): { r: number; density: number } {
  const R = t.smokeWidthM / 2;
  const bloom = t.smokeBloomSeconds * t.hz;
  const thinning = age - bloom - t.smokeHoldSeconds * t.hz;
  if (age < 0) return { r: 0, density: 0 };
  if (age < bloom) return { r: (R * age) / bloom, density: 1 };
  if (thinning <= 0) return { r: R, density: 1 };
  const density = Math.max(0, 1 - thinning / (t.smokeThinSeconds * t.hz));
  return { r: R * density, density };
}

/** The line from `a` to `b` touches a live smoke disc: nobody on the ground sees along it, whichever end is inside or behind the smoke. */
export function smoked(m: Match, a: Vec2, b: Vec2): boolean {
  for (const e of m.assets.effects) {
    if (e.asset !== 'smoke') continue;
    for (const s of e.shells!) {
      const { r } = smokeDisc(m.tune, m.tick - s.land);
      if (r > 0 && segDist2(s, a, b) <= r * r) return true;
    }
  }
  return false;
}
