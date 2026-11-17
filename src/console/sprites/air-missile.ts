// A lock-on missile (#110) as it is drawn: it leaves its launcher on the ground and climbs to the altitude of what it chases
// over its first moments, its motor flickering; it ends in the air as an airburst on a hit (a flash, a ring, fragments, smoke)
// or, spent after a miss, as a small dark puff. layers/air-missiles.ts draws it, and its smoke along the path it flew.
import type { Vec2 } from '../../sim/types';
import { type ImpactGlow, type ImpactSprite, type ImpactStreak, WIND } from './impact';
import { ALTITUDE_LIFT_PER_M, CRUISE_ALTITUDE_M } from './missile';
import { SHADOW_DIR } from './sheet';
import { SMOKE_PUFF_VARIANTS } from './smoke-puff';

/** It reaches its altitude this long after it leaves the launcher. */
export const CLIMB_MS = 900;
/** Its body, in metres. */
export const BODY_M = 4;

/** How high it flies `age` ms after launch, 0..1 of the cruise altitude: off the ground, easing in and out. */
export function climbed(age: number): number {
  const u = Math.max(0, Math.min(1, age / CLIMB_MS));
  return u * u * (3 - 2 * u);
}
/** `p` on the ground as drawn `height` (0..1) of the way up. */
export const lifted = (p: Vec2, height: number): Vec2 => ({ x: p.x - SHADOW_DIR.x * CRUISE_ALTITUDE_M * ALTITUDE_LIFT_PER_M * height, y: p.y - SHADOW_DIR.y * CRUISE_ALTITUDE_M * ALTITUDE_LIFT_PER_M * height });
/** Its motor's glare `seconds` in: a flicker. */
export const glare = (seconds: number) => 0.75 + 0.25 * Math.sin(seconds * 60);

export interface Burst extends Vec2 {
  at: number;
  hit: boolean;
  seed: number;
}

export interface BurstLook {
  flash: ImpactGlow | null;
  /** A shock ring in the air; `size` is the ring's quad. */
  ring: ImpactGlow | null;
  fragments: ImpactStreak[];
  /** Grey smoke on a hit; one dark puff when it destroys itself. */
  smoke: (ImpactSprite & { dark?: boolean })[];
}

const hash = (n: number) => Math.abs(Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1;

/** What the burst `b` shows `now`, at its place in the air (already lifted). */
export function burstLook(b: Burst, now: number): BurstLook {
  const age = now - b.at;
  const s = age / 1000;
  const look: BurstLook = { flash: null, ring: null, fragments: [], smoke: [] };
  if (age < 0) return look;
  if (!b.hit) {
    if (age < 90) look.flash = { x: b.x, y: b.y, size: 5, opacity: 1 - age / 90 };
    if (s < 1.8) look.smoke.push({ x: b.x + WIND.x * s * 3, y: b.y + WIND.y * s * 3, size: 4 + 6 * Math.sqrt(s / 1.8), frame: b.seed % SMOKE_PUFF_VARIANTS, flip: false, opacity: 0.6 * (1 - s / 1.8), dark: true });
    return look;
  }
  if (age < 140) look.flash = { x: b.x, y: b.y, size: 8 + (14 * age) / 140, opacity: 1 - age / 140 };
  if (age < 400) {
    const k = age / 400;
    look.ring = { x: b.x, y: b.y, size: 6 + 26 * (1 - (1 - k) ** 2.4), opacity: 0.7 * (1 - k) };
  }
  for (let i = 0; i < 16; i++) {
    const life = s / (0.25 + 0.25 * hash(b.seed * 13 + i));
    if (life >= 1) continue;
    const a = hash(b.seed * 17 + i) * Math.PI * 2;
    const v = 40 + 60 * hash(b.seed * 19 + i);
    const [head, tail] = [v * s, Math.max(0, v * s - 4)];
    look.fragments.push({ x0: b.x + Math.cos(a) * tail, y0: b.y + Math.sin(a) * tail, x1: b.x + Math.cos(a) * head, y1: b.y + Math.sin(a) * head, opacity: 1 - life, heat: 1 - life });
  }
  for (let i = 0; i < 5; i++) {
    const a = s - i * 0.05;
    const life = 2.4 + 1.4 * hash(b.seed * 23 + i);
    if (a < 0 || a >= life) continue;
    const dir = hash(b.seed * 29 + i) * Math.PI * 2;
    const out = (10 * (1 - Math.exp(-2 * a))) / 2;
    look.smoke.push({ x: b.x + Math.cos(dir) * out + WIND.x * a * 4, y: b.y + Math.sin(dir) * out + WIND.y * a * 4, size: 6 + 12 * Math.sqrt(a / life), frame: i % SMOKE_PUFF_VARIANTS, flip: i % 2 === 1, opacity: 0.5 * Math.min(1, a / 0.2) * (1 - a / life) });
  }
  return look;
}
