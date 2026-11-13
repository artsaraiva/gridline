// DEV-only tune override for review scenes. The worker imports it in every build, but only passes
// `freeAssets: true` under `import.meta.env.DEV`, so production tunes are never changed.
import { DEFAULT_TUNE } from '../sim/tune';
import type { Tune } from '../sim/types';

/**
 * Returns a tune that keeps Asset cooldowns at zero, and the heavy Assets' point gate open (Missile, #101 Gunship), so every Asset cycles continuously;
 * #107 `tanks` sets the tank slots per Side (`?tanks=3`), so tank fights come quickly.
 */
export function devTune(freeAssets: boolean, tanks?: number): Tune {
  const t = tanks !== undefined ? { ...DEFAULT_TUNE, tanksPerSide: tanks } : DEFAULT_TUNE;
  if (!freeAssets) return t;
  return {
    ...t,
    scanCooldownSeconds: 0,
    supplyCooldownSeconds: 0,
    barrageCooldownSeconds: 0,
    missileCooldownSeconds: 0,
    gunshipCooldownSeconds: 0,
    smokeCooldownSeconds: 0,
    creepCooldownSeconds: 0,
    missileGated: false,
    matchSeconds: 3600,
  };
}
