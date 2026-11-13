// The Smoke Screen on the map (#138): each disc is a soft grey blot under puffs that rise, drift and fade one after the
// other for as long as it stands. All of it is the shell trail's baked puff (smoke-puff.ts), bigger and longer-lived.
// layers/smoke-screen.ts draws it. The sizes and timings are Console look, not bake or Tune values.
import type { EffectView } from '../../sim/types';
import { type ImpactSprite, WIND } from './impact';
import { SMOKE_PUFF_VARIANTS } from './smoke-puff';

type Disc = NonNullable<EffectView['smoke']>[number];

/** The blot is drawn this much wider than the disc: a puff's baked edge is soft, and the smoke must cover what it hides. */
const BLOT_OVER = 4.4;
const BLOT_OPACITY = 0.92;
const PUFFS = 6;
/** Seconds one puff takes to rise from the ground and fade. */
const RISE_SECONDS = 7;
const PUFF_OPACITY = 0.8;

const hash = (n: number) => Math.abs(Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1;

/**
 * What disc `i` of a Smoke Screen shows: the blot first, then its puffs. A puff is born at a spot inside the disc, grows and
 * rides the wind as it rises, and fades out; the next is born elsewhere, so the smoke never repeats. Everything dims as the
 * disc thins.
 */
export function smokeLook(d: Disc, i: number): ImpactSprite[] {
  const seed = i * 31 + Math.round(d.x * 7 + d.y * 13);
  const blot = { x: d.x, y: d.y, size: BLOT_OVER * d.r, frame: Math.abs(seed) % SMOKE_PUFF_VARIANTS, flip: hash(seed) < 0.5, opacity: BLOT_OPACITY * d.density };
  const out: ImpactSprite[] = [blot];
  for (let k = 0; k < PUFFS; k++) {
    const turn = d.age / RISE_SECONDS + k / PUFFS + hash(seed + k);
    const life = turn % 1;
    const born = seed + k * 17 + Math.floor(turn) * 101; // a new spot each time it is born
    const a = hash(born) * Math.PI * 2;
    const off = hash(born + 0.5) * 0.6 * d.r;
    const drift = life * RISE_SECONDS;
    out.push({
      x: d.x + Math.cos(a) * off + WIND.x * drift,
      y: d.y + Math.sin(a) * off + WIND.y * drift,
      size: d.r * (2.2 + 1.6 * life),
      frame: Math.floor(hash(born + 0.25) * SMOKE_PUFF_VARIANTS),
      flip: hash(born + 0.75) < 0.5,
      opacity: PUFF_OPACITY * d.density * Math.sin(Math.PI * life) * Math.min(1, d.age), // nothing in its first instant on the ground
    });
  }
  return out;
}
