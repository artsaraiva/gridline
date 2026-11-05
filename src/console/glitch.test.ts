import { describe, expect, it } from 'vitest';
import { glitchScheduler } from './glitch';

describe('glitch bursts', () => {
  it('starts a burst on request and refuses another within 4 s', () => {
    const g = glitchScheduler(() => 1);
    expect(g.burst(10_000, 0.5)).toBe(true);
    expect(g.level(10_000)).toBeCloseTo(0.5);
    expect(g.burst(13_999, 0.8)).toBe(false);
    expect(g.burst(14_000, 0.8)).toBe(true);
    expect(g.level(14_000)).toBeCloseTo(0.8);
  });

  it('decays to nothing within half a second, so a burst is over before the next may start', () => {
    const g = glitchScheduler(() => 1);
    g.burst(0, 1);
    expect(g.level(200)).toBeGreaterThan(0);
    expect(g.level(200)).toBeLessThan(1);
    expect(g.level(500)).toBe(0);
    expect(g.level(3_999)).toBe(0);
  });

  it('throws in idle bursts at random, still at least 4 s apart', () => {
    const always = glitchScheduler(() => 0);
    const starts: number[] = [];
    for (let now = 0; now <= 20_000; now += 16) if (always.frame(now, 16)) starts.push(now);
    expect(starts).toEqual([0, 4000, 8000, 12_000, 16_000, 20_000]);

    const never = glitchScheduler(() => 0.999);
    for (let now = 0; now <= 20_000; now += 16) expect(never.frame(now, 16)).toBe(false);
  });

  it('averages about one idle burst every 12 s', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = glitchScheduler(random);
    let count = 0;
    for (let now = 0; now <= 1_200_000; now += 16) if (g.frame(now, 16)) count++;
    expect(count).toBeGreaterThan(60); // 1200 s / (12 s + 4 s dead time) = 75
    expect(count).toBeLessThan(90);
  });
});
