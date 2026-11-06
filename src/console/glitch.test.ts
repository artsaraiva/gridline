import { describe, expect, it } from 'vitest';
import { GAP_MS, glitchScheduler, IDLE_EVERY_MS } from './glitch';

describe('glitch bursts', () => {
  it('starts a burst on request and refuses another within the gap (#91: 15 s)', () => {
    expect(GAP_MS).toBe(15_000);
    const g = glitchScheduler(() => 1);
    expect(g.burst(10_000, 0.5)).toBe(true);
    expect(g.level(10_000)).toBeCloseTo(0.5);
    expect(g.burst(10_000 + GAP_MS - 1, 0.8)).toBe(false);
    expect(g.burst(10_000 + GAP_MS, 0.8)).toBe(true);
    expect(g.level(10_000 + GAP_MS)).toBeCloseTo(0.8);
  });

  it('decays to nothing within half a second, so a burst is over before the next may start', () => {
    const g = glitchScheduler(() => 1);
    g.burst(0, 1);
    expect(g.level(200)).toBeGreaterThan(0);
    expect(g.level(200)).toBeLessThan(1);
    expect(g.level(500)).toBe(0);
    expect(g.level(GAP_MS - 1)).toBe(0);
  });

  it('throws in idle bursts at random, still a gap apart, and weak (#91)', () => {
    const always = glitchScheduler(() => 0);
    const starts: number[] = [];
    for (let now = 0; now <= 60_000; now += 16) if (always.frame(now, 16)) starts.push(now);
    expect(starts).toEqual([0, 15_008, 30_016, 45_024, 60_032].filter((t) => t <= 60_000));
    expect(always.level(starts.at(-1)!)).toBeLessThanOrEqual(0.4);

    const never = glitchScheduler(() => 0.999);
    for (let now = 0; now <= 60_000; now += 16) expect(never.frame(now, 16)).toBe(false);
  });

  it('averages about one idle burst a minute', () => {
    expect(IDLE_EVERY_MS).toBe(60_000);
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = glitchScheduler(random);
    let count = 0;
    for (let now = 0; now <= 6_000_000; now += 16) if (g.frame(now, 16)) count++;
    expect(count).toBeGreaterThan(60); // 6000 s / (60 s + 15 s dead time) = 80
    expect(count).toBeLessThan(100);
  });
});
