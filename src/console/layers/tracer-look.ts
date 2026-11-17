// What a shot shows as it ages: a round that flies at a readable speed, sized and paced by who fired it, and what it
// kicks up where it lands (dust on a miss, sparks on a hit, now and then a ricochet). Nothing at the muzzle. Pure maths, DOM-free so it is testable; tracers.ts draws it. Values judged by eye in the review scene.
import type { Vec2, VehicleKind } from '../../sim/types';

/** A round crosses the map this fast: far under a real bullet, so the eye can follow it (100 m in about a quarter second). */
export const ROUND_MPS = 420;
/** The streak behind the round's head, in metres. */
export const ROUND_LENGTH_M = 12;

/** Who fired: a Soldier on foot, or the gunner of a vehicle of this class. */
export type Shooter = 'foot' | VehicleKind;
/**
 * A round by its shooter: its size next to the base round, and its speed in m/s. A rifle's is a little smaller; a tank's
 * and a jet's machine gun smaller still, so they never hide the main gun's round; an AA gun's is fast, as BF4's; a
 * helicopter's minigun fast and a touch smaller. Anything else fires the base round.
 */
const ROUNDS: Partial<Record<Shooter, { size: number; mps: number }>> = {
  foot: { size: 0.85, mps: ROUND_MPS },
  tank: { size: 0.8, mps: ROUND_MPS },
  jet: { size: 0.8, mps: ROUND_MPS },
  aa: { size: 1, mps: 1100 },
  helicopter: { size: 0.9, mps: 900 },
};
export const roundOf = (shooter: Shooter) => ROUNDS[shooter] ?? { size: 1, mps: ROUND_MPS };
/** A round's streak in metres: the base length at its size, longer the faster it flies, so a fast round still reads as a line. */
export const roundLength = (r: { size: number; mps: number }) => ROUND_LENGTH_M * r.size * Math.sqrt(r.mps / ROUND_MPS);

/** Time for a round to fly from `from` to `to`, in ms. */
export const flightMs = (from: Vec2, to: Vec2, mps = ROUND_MPS) => (Math.hypot(to.x - from.x, to.y - from.y) / mps) * 1000;

/** The round's streak `age` ms after the shot, `length` metres long: tail and head on the line to `to`. Null once it has landed. */
export function roundAt(from: Vec2, to: Vec2, age: number, length = ROUND_LENGTH_M, mps = ROUND_MPS): { tail: Vec2; head: Vec2 } | null {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (age < 0 || d === 0 || age > flightMs(from, to, mps)) return null;
  const head = Math.min(d, (mps * age) / 1000);
  const tail = Math.max(0, head - length);
  const at = (m: number) => ({ x: from.x + ((to.x - from.x) * m) / d, y: from.y + ((to.y - from.y) * m) / d });
  return { tail: at(tail), head: at(head) };
}

export type KickKind = 'dust' | 'spark' | 'ricochet';
/** How long each lasts, in ms. */
export const KICK_MS: Record<KickKind, number> = { dust: 650, spark: 200, ricochet: 130 };

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

/** A dust puff `age` ms old: its radius in metres and its opacity. Null once gone. */
export function puffAt(age: number): { radius: number; opacity: number } | null {
  const k = age / KICK_MS.dust;
  if (k < 0 || k >= 1) return null;
  return { radius: 0.7 + 2.6 * Math.sqrt(k), opacity: 0.34 * (1 - k) };
}

/** A spark or ricochet `age` ms old: how far its tail and head are from where it started, in metres, and its opacity. Null once gone. */
export function sparkAt(k: Kick, age: number): { tail: number; head: number; opacity: number } | null {
  if (k.kind !== 'spark' && k.kind !== 'ricochet') return null;
  const life = age / KICK_MS[k.kind];
  if (life < 0 || life >= 1) return null;
  const head = (k.speed * age) / 1000;
  return { tail: Math.max(0, head - (k.kind === 'ricochet' ? 8 : 2.3)), head, opacity: 0.9 * (1 - life) };
}
