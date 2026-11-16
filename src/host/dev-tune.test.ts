import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNE } from '../sim/tune';
import { ASSET_KINDS } from '../sim/types';
import { devTune } from './dev-tune';

describe('devTune', () => {
  it('returns the default tune when freeAssets is off', () => {
    expect(devTune(false)).toBe(DEFAULT_TUNE);
  });

  it('zeros every Asset cooldown and extends match time for review scenes', () => {
    const t = devTune(true);
    for (const k of ASSET_KINDS) expect(t[`${k}CooldownSeconds`], k).toBe(0);
    expect(t.missileGated).toBe(false);
    expect(t.matchSeconds).toBe(3600);
    expect(t).not.toBe(DEFAULT_TUNE);
  });
});
