import type { Match } from './index';

/** mulberry32: seeded 32-bit RNG, returns [0, 1). The only randomness in the Simulation. */
export function rnd(m: Match): number {
  m.rng = (m.rng + 0x6d2b79f5) | 0;
  let t = m.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform in [lo, hi]. A range of one value draws nothing, so a tune that pins a Trait (`[180, 180]`, `[0, 0]`) leaves the RNG stream, and so every later draw, as it was without the Trait. */
export const between = (m: Match, [lo, hi]: [number, number]) => (lo === hi ? lo : lo + (hi - lo) * rnd(m));

/** The index of one of `weights` drawn in proportion to its weight (one draw, even when none is positive); -1 when none is positive. */
export function pickWeighted(m: Match, weights: number[]): number {
  let r = rnd(m) * weights.reduce((a, w) => a + w, 0);
  return weights.findIndex((w) => w > 0 && (r -= w) < 0);
}
