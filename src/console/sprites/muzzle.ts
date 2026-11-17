// A heavy gun's muzzle blast: a white flash and the light it throws, a dart of flame with two jets off the brake, a dust
// ring running out along the ground and smoke blown forward that drifts off. Only heavy guns have one (a battery's gun, a
// tank's main gun, a missile leaving its launcher); a Soldier's or a machine gun's muzzle shows nothing. layers/muzzle.ts
// draws it. Console look only, judged by eye.
import type { Vec2 } from '../../sim/types';
import { type ImpactGlow, type ImpactSprite, type ImpactStreak, WIND } from './impact';
import { SMOKE_PUFF_VARIANTS } from './smoke-puff';

/** One blast: where the muzzle is, the bearing it fired on (radians), when (ms), and how big next to a battery gun's. */
export interface MuzzleBlast extends Vec2 {
  heading: number;
  at: number;
  power: number;
  /** A missile's backblast: no dart, the smoke thrown back the other way. */
  back?: boolean;
}

/** A blast's marks are over by now, in ms. */
export const MUZZLE_BLAST_MS = 3600;

export interface MuzzleLook {
  flash: ImpactGlow | null;
  /** The light the shot throws on the ground round the gun. */
  light: ImpactGlow | null;
  /** The dart of flame out of the muzzle, and two short jets off the brake. */
  flames: ImpactStreak[];
  /** A dust ring running out round the gun; `size` is the ring's quad. */
  ring: ImpactGlow | null;
  smoke: ImpactSprite[];
}

const SMOKE_PUFFS = 5;
const hash = (n: number) => Math.abs(Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1;

/** What the blast `b` shows `now`. */
export function muzzleLook(b: MuzzleBlast, now: number): MuzzleLook {
  const age = now - b.at;
  const sec = age / 1000;
  const p = b.power;
  const [cx, cy] = [Math.cos(b.heading), Math.sin(b.heading)];
  const look: MuzzleLook = { flash: null, light: null, flames: [], ring: null, smoke: [] };
  if (age < 0) return look;
  if (age < 110) look.flash = { x: b.x, y: b.y, size: (7 + (5 * age) / 110) * p, opacity: 1 - age / 110 };
  if (age < 320) look.light = { x: b.x, y: b.y, size: 46 * p, opacity: 0.4 * (1 - age / 320) };
  if (age < 140 && !b.back) {
    const left = 1 - age / 140;
    const dart = 16 * p * (age < 60 ? 1 : 0.6);
    look.flames.push({ x0: b.x, y0: b.y, x1: b.x + cx * dart, y1: b.y + cy * dart, opacity: left, heat: left });
    for (const side of [1, -1]) look.flames.push({ x0: b.x, y0: b.y, x1: b.x - cx * 1.2 * p - cy * side * 5 * p, y1: b.y - cy * 1.2 * p + cx * side * 5 * p, opacity: left, heat: left });
  }
  if (age < 800) {
    const k = age / 800;
    look.ring = { x: b.x - cx * 4 * p, y: b.y - cy * 4 * p, size: (8 + 30 * (1 - (1 - k) ** 2.4)) * p, opacity: 0.35 * (1 - k) };
  }
  const way = b.back ? -1 : 1;
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const a = sec - i * 0.04;
    const life = 2.2 + 1.2 * hash(b.at + i);
    if (a < 0 || a >= life) continue;
    const out = ((40 + 60 * hash(b.at * 3 + i)) * p * (1 - Math.exp(-2.4 * a))) / 2.4; // blown out, then held by drag
    const across = (hash(b.at * 5 + i) - 0.5) * 6 * p;
    look.smoke.push({
      x: b.x + way * cx * out - cy * across + WIND.x * a * 4,
      y: b.y + way * cy * out + cx * across + WIND.y * a * 4,
      size: (5 + 11 * Math.sqrt(a / life)) * p,
      frame: i % SMOKE_PUFF_VARIANTS,
      flip: i % 2 === 1,
      opacity: 0.45 * Math.min(1, a / 0.2) * (1 - a / life),
    });
  }
  return look;
}
