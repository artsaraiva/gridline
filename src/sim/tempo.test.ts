// #121 Think tempo and staggered set-off: each Squad's own think interval, each Soldier's own reaction (ADR 0006).
import { describe, expect, it } from 'vitest';
import { createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { MapData, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;
const [IMIN, IMAX] = DEFAULT_TUNE.thinkIntervalSeconds;
const [RMIN, RMAX] = DEFAULT_TUNE.reactionSeconds;
const J = DEFAULT_TUNE.thinkJitter;

const field: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [
    { id: 'N', name: 'N', x: -300, y: -200 },
    { id: 'S', name: 'S', x: -100, y: 100 },
  ],
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
};
function scene(squadsPerSide: number, seed = 1, tune: Partial<Tune> = {}): Match {
  const t: Tune = { ...DEFAULT_TUNE, speedJitter: 0, visionM: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, pointJeeps: false, ...tune };
  return createMatch({ seed, map: field, tune: t, squadsPerSide, commanderSide: 'nato' });
}
const seeds = Array.from({ length: 10 }, (_, i) => i + 1);

describe('#121 think tempo', () => {
  /** The ticks each Squad thought on, seen as its next-think tick moving on. */
  const thinks = (m: Match, seconds: number) => {
    const out = m.squads.map(() => [] as number[]);
    for (let i = 0; i < seconds * HZ; i++) {
      const before = m.squads.map((sq) => sq.nextThink);
      step(m, []);
      m.squads.forEach((sq, k) => sq.nextThink !== before[k] && out[k]!.push(m.tick - 1));
    }
    return out;
  };

  it('Squads draw their own intervals, each think lands within the jitter of it, and no two Squads open together', () => {
    const m = scene(5);
    const ticks = thinks(m, 40);
    expect(new Set(m.squads.map((sq) => sq.thinkInterval)).size).toBeGreaterThan(5);
    ticks.forEach((tk, k) => {
      const iv = m.squads[k]!.thinkInterval;
      expect(iv).toBeGreaterThanOrEqual(IMIN);
      expect(iv).toBeLessThanOrEqual(IMAX);
      expect(tk[0]).toBeLessThanOrEqual(Math.ceil(iv * HZ));
      for (let n = 1; n < tk.length; n++) {
        const gap = (tk[n]! - tk[n - 1]!) / HZ;
        expect(gap).toBeGreaterThanOrEqual(iv * (1 - J) - 1 / HZ);
        expect(gap).toBeLessThanOrEqual(iv * (1 + J) + 1 / HZ);
      }
      expect(new Set(tk.slice(1).map((t, n) => t - tk[n]!)).size).toBeGreaterThan(1); // it drifts
    });
    expect(ticks.filter((tk) => tk[0] === 0).length).toBeLessThanOrEqual(1);
    expect(new Set(ticks.map((tk) => tk[0])).size).toBeGreaterThan(5);
  });
});

describe('#121 staggered set-off', () => {
  /** Ticks after the Squad's first goal pick that each member first moved; `fire` keeps the Squad under fire throughout. */
  const setOff = (seed: number, fire = false, detach = false) => {
    const m = scene(1, seed, detach ? { squadGoalBias: 0, choiceMargin: 0, commitSeconds: [0, 0], squadPull: 0 } : {});
    const sq = m.squads[0]!;
    if (detach) Object.assign(m.soldiers[1]!, { detached: true, x: -100, y: 0 }); // nearer S than the Squad is
    let picked = -1;
    const moved: number[] = sq.members.map(() => -1);
    for (let i = 0; i < 6 * HZ; i++) {
      if (fire) sq.lastHit = m.tick;
      const at = sq.members.map((id) => ({ x: m.soldiers[id]!.x, y: m.soldiers[id]!.y }));
      step(m, []);
      if (picked < 0 && sq.goal >= 0) picked = m.tick - 1;
      sq.members.forEach((id, k) => {
        const s = m.soldiers[id]!;
        if (picked >= 0 && moved[k]! < 0 && (s.x !== at[k]!.x || s.y !== at[k]!.y)) moved[k] = m.tick - 1 - picked;
      });
    }
    return moved;
  };

  it('members on foot set off on different ticks, each within the reaction range', () => {
    const staggered = seeds.filter((seed) => {
      const moved = setOff(seed);
      for (const d of moved) {
        expect(d).toBeGreaterThanOrEqual(Math.round(RMIN * HZ));
        expect(d).toBeLessThanOrEqual(Math.round(RMAX * HZ));
      }
      return new Set(moved).size > 1;
    });
    expect(staggered.length).toBeGreaterThanOrEqual(8);
  });

  it('nobody holds under fire', () => {
    for (const seed of seeds) expect(setOff(seed, true)).toEqual([0, 0, 0, 0]);
  });

  it('a Detached Soldier holds too when it picks a point of its own', () => {
    const moved = setOff(3, false, true)[1]!;
    expect(moved).toBeGreaterThanOrEqual(Math.round(RMIN * HZ));
    expect(moved).toBeLessThanOrEqual(Math.round(RMAX * HZ));
  });
});
