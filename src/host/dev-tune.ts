// DEV-only tune override for review scenes. The worker imports it in every build, but only passes
// `freeAssets: true` under `import.meta.env.DEV`, so production tunes are never changed.
import { DEFAULT_TUNE } from '../sim/tune';
import type { Tune } from '../sim/types';

/** Returns a tune that keeps Asset cooldowns at zero so Barrage, Scan, Supply Drop and the Missile cycle continuously. */
export function devTune(freeAssets: boolean): Tune {
  if (!freeAssets) return DEFAULT_TUNE;
  return {
    ...DEFAULT_TUNE,
    scanCooldownSeconds: 0,
    supplyCooldownSeconds: 0,
    barrageCooldownSeconds: 0,
    missileCooldownSeconds: 0,
    matchSeconds: 3600,
  };
}
