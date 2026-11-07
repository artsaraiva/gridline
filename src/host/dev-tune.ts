// DEV-only tune override for review scenes. The worker imports it in every build, but only passes
// `freeAssets: true` under `import.meta.env.DEV`, so production tunes are never changed.
import { DEFAULT_TUNE } from '../sim/tune';
import type { Tune } from '../sim/types';

/** Returns a tune that keeps Asset cooldowns at zero, and the Missile's point gate open, so every Asset cycles continuously. */
export function devTune(freeAssets: boolean): Tune {
  if (!freeAssets) return DEFAULT_TUNE;
  return {
    ...DEFAULT_TUNE,
    scanCooldownSeconds: 0,
    supplyCooldownSeconds: 0,
    barrageCooldownSeconds: 0,
    missileCooldownSeconds: 0,
    missileGated: false,
    matchSeconds: 3600,
  };
}
