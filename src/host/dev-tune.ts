// DEV-only tune override for review scenes. Production builds never reach this file.
import { DEFAULT_TUNE } from '../sim/tune';
import type { Tune } from '../sim/types';

/** Returns a tune that keeps Asset cooldowns at zero so Barrage, Scan and Supply Drop cycle continuously. */
export function devTune(freeAssets: boolean): Tune {
  if (!freeAssets) return DEFAULT_TUNE;
  return {
    ...DEFAULT_TUNE,
    scanCooldownSeconds: 0,
    supplyCooldownSeconds: 0,
    barrageCooldownSeconds: 0,
    matchSeconds: 3600,
  };
}
