import type { Match } from './index';

/** mulberry32: seeded 32-bit RNG, returns [0, 1). The only randomness in the Simulation. */
export function rnd(m: Match): number {
  m.rng = (m.rng + 0x6d2b79f5) | 0;
  let t = m.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
