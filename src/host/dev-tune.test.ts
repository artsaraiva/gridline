import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNE } from '../sim/tune';
import { devTune } from './dev-tune';

describe('devTune', () => {
  it('returns the default tune when freeAssets is off', () => {
    expect(devTune(false)).toBe(DEFAULT_TUNE);
  });

  it('zeros Asset cooldowns and extends match time for review scenes', () => {
    const t = devTune(true);
    expect(t.scanCooldownSeconds).toBe(0);
    expect(t.supplyCooldownSeconds).toBe(0);
    expect(t.barrageCooldownSeconds).toBe(0);
    expect(t.matchSeconds).toBe(3600);
    expect(t).not.toBe(DEFAULT_TUNE);
  });
});
