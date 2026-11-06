import { describe, expect, it } from 'vitest';
import { admit, admitImpact, admitShot, busGain, chatterGap, newGate, TUNING } from './audio-mix';

describe('bus and ducking gains (#84)', () => {
  it('a bus at its level plays at that level; the master mute silences it', () => {
    expect(busGain(0.8, { ducked: false, muted: false })).toBeCloseTo(0.8);
    expect(busGain(0.8, { ducked: false, muted: true })).toBe(0);
  });

  it('a ducked bus drops by TUNING.duckDb: 6 dB is half the amplitude', () => {
    TUNING.duckDb = 6;
    expect(busGain(0.8, { ducked: true, muted: false })).toBeCloseTo(0.4, 2);
  });
});

describe('Chatter gap selection (#84)', () => {
  it('idle: 8 s at the bottom of the draw, 25 s at the top', () => {
    expect(chatterGap(false, () => 0)).toBe(8);
    expect(chatterGap(false, () => 0.999999)).toBeCloseTo(25, 3);
  });

  it('in combat: 3 to 8 s', () => {
    expect(chatterGap(true, () => 0)).toBe(3);
    expect(chatterGap(true, () => 0.5)).toBe(5.5);
  });
});

describe('repetition control (#84)', () => {
  it('shots from one Squad coalesce into one burst per window; another Squad gets its own', () => {
    TUNING.coalesceSeconds = 0.5;
    const g = newGate();
    expect(admitShot(g, 'alpha', 10)).toBe(true);
    expect(admitShot(g, 'alpha', 10.2)).toBe(false);
    expect(admitShot(g, 'bravo', 10.2)).toBe(true);
    expect(admitShot(g, 'alpha', 10.5)).toBe(true);
  });

  it('impacts land no closer than the spacing', () => {
    TUNING.impactGapSeconds = 0.2;
    const g = newGate();
    expect(admitImpact(g, 5)).toBe(true);
    expect(admitImpact(g, 5.1)).toBe(false);
    expect(admitImpact(g, 5.2)).toBe(true);
  });

  it('at most maxConcurrent combat sounds at once: the newest wins and the oldest is evicted', () => {
    TUNING.maxConcurrent = 2;
    const g = newGate();
    expect(admit(g, 'a', 0, 1)).toEqual([]);
    expect(admit(g, 'b', 0.1, 1)).toEqual([]);
    expect(admit(g, 'c', 0.2, 1)).toEqual(['a']);
    expect(admit(g, 'd', 0.3, 1)).toEqual(['b']);
  });

  it('a sound that has ended frees its slot', () => {
    TUNING.maxConcurrent = 1;
    const g = newGate();
    admit(g, 'a', 0, 0.5);
    expect(admit(g, 'b', 1, 2)).toEqual([]);
  });
});
