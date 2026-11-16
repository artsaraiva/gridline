// What a shot shows as it ages: a round that flies at a readable speed, a two-frame muzzle flash that lights the ground,
// and what the round kicks up where it lands (dust on a miss, sparks on a hit, now and then a ricochet, a wisp at the
// muzzle). Pure maths, DOM-free so it is testable; tracers.ts draws it. Values judged by eye in the review scene.
import type { Vec2 } from '../../sim/types';

/** A round crosses the map this fast: far under a real bullet, so the eye can follow it (100 m in about a quarter second). */
export const ROUND_MPS = 420;
/** The streak behind the round's head, in metres. */
export const ROUND_LENGTH_M = 12;
/** The muzzle flash: hot and long for its first frame, then smaller until it is gone. */
export const FLASH_MS = 75;
export const FLASH_HOT_MS = 30;

/** Time for a round to fly from `from` to `to`, in ms. */
export const flightMs = (from: Vec2, to: Vec2) => (Math.hypot(to.x - from.x, to.y - from.y) / ROUND_MPS) * 1000;

/** The round's streak `age` ms after the shot, `length` metres long: tail and head on the line to `to`. Null once it has landed. */
export function roundAt(from: Vec2, to: Vec2, age: number, length = ROUND_LENGTH_M): { tail: Vec2; head: Vec2 } | null {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (age < 0 || d === 0 || age > flightMs(from, to)) return null;
  const head = Math.min(d, (ROUND_MPS * age) / 1000);
  const tail = Math.max(0, head - length);
  const at = (m: number) => ({ x: from.x + ((to.x - from.x) * m) / d, y: from.y + ((to.y - from.y) * m) / d });
  return { tail: at(tail), head: at(head) };
}

/** The muzzle flash `age` ms after the shot: its size next to the hot frame (1), and how bright its light on the ground is. Null once gone. */
export function flashAt(age: number): { size: number; light: number } | null {
  if (age < 0 || age >= FLASH_MS) return null;
  return { size: age < FLASH_HOT_MS ? 1 : 0.6, light: 1 - age / FLASH_MS };
}

export type KickKind = 'dust' | 'wisp' | 'spark' | 'ricochet';
/** How long each lasts, in ms. */
export const KICK_MS: Record<KickKind, number> = { dust: 650, wisp: 1100, spark: 200, ricochet: 130 };

export interface Kick {
  kind: KickKind;
  x: number;
  y: number;
  at: number;
  /** A spark's or ricochet's heading in radians and speed in m/s. */
  angle: number;
  speed: number;
}

/**
 * What a round kicks up when it lands at `to`, flying along `heading` (radians): sparks thrown back on a hit, a dust puff on
 * a miss and, one miss in six, a ricochet glancing on. `random` is 0..1.
 */
export function landing(to: Vec2, heading: number, hit: boolean, at: number, random: () => number): Kick[] {
  const kick = (kind: KickKind, angle = 0, speed = 0): Kick => ({ kind, x: to.x, y: to.y, at, angle, speed });
  if (hit) return [0, 1, 2, 3].map(() => kick('spark', heading + Math.PI + (random() - 0.5) * 2.2, 20 + random() * 35));
  const out = [kick('dust')];
  if (random() < 1 / 6) out.push(kick('ricochet', heading + (random() - 0.5) * 1.8, 200));
  return out;
}

/** A puff (dust, wisp) `age` ms old: its radius in metres and its opacity. Null once gone. */
export function puffAt(kind: 'dust' | 'wisp', age: number): { radius: number; opacity: number } | null {
  const k = age / KICK_MS[kind];
  if (k < 0 || k >= 1) return null;
  const [r0, r1, peak] = kind === 'dust' ? [0.7, 3.3, 0.34] : [1, 3.7, 0.2];
  return { radius: r0 + (r1 - r0) * Math.sqrt(k), opacity: peak * (1 - k) };
}

/** A spark or ricochet `age` ms old: how far its tail and head are from where it started, in metres, and its opacity. Null once gone. */
export function sparkAt(k: Kick, age: number): { tail: number; head: number; opacity: number } | null {
  if (k.kind !== 'spark' && k.kind !== 'ricochet') return null;
  const life = age / KICK_MS[k.kind];
  if (life < 0 || life >= 1) return null;
  const head = (k.speed * age) / 1000;
  return { tail: Math.max(0, head - (k.kind === 'ricochet' ? 8 : 2.3)), head, opacity: 0.9 * (1 - life) };
}
