// What a shot shows as it ages: a round that flies at a readable speed, sized and paced by who fired it, and what it
// kicks up where it lands (dust on a miss, sparks on a hit, now and then a ricochet). Nothing at the muzzle. Pure maths, DOM-free so it is testable; tracers.ts draws it. Values judged by eye in the review scene.
import type { GunKind, Vec2, VehicleKind } from '../../sim/types';

/** A round crosses the map this fast: far under a real bullet, so the eye can follow it (100 m in about a quarter second). */
export const ROUND_MPS = 420;
/** The streak behind the round's head, in metres. */
export const ROUND_LENGTH_M = 12;

/** Who fired: a Soldier on foot, or the gunner of a vehicle of this class. */
export type Shooter = 'foot' | VehicleKind;

/**
 * A round as it is drawn. `size` is its width next to the base round and `mps` its speed; `length` stretches or shortens its
 * streak; `kick` sizes what it throws up where it lands, and `lands` says what that is when it is not dust or sparks: a small
 * shell burst (`burst`) or, on a target in the air, a flak puff (`flak`). `vapour` leaves a thread hanging along its path
 * (its opacity); `rope` draws that many rounds for one shot, fine and close together; `twin` fires from two barrels in turn,
 * with a flash at the muzzle (a heavy gun only: nothing else flashes).
 */
export interface Round {
  size: number;
  mps: number;
  length?: number;
  kick?: number;
  lands?: 'burst' | 'flak';
  vapour?: number;
  rope?: number;
  twin?: boolean;
}

/**
 * A Soldier's round by its gun. They share one tint and no mark: the gun shows in its cadence (the Simulation's), and here in
 * how long, fast and heavy the round is. An SMG's is short and light; an LMG's a rifle's, a touch heavier; a DMR's long and
 * fast; a sniper rifle's a long fast bolt that leaves a thread of vapour and kicks hard where it lands.
 */
const GUNS: Record<GunKind, Round> = {
  rifle: { size: 0.85, mps: ROUND_MPS },
  smg: { size: 0.65, mps: 380, length: 0.6, kick: 0.7 },
  lmg: { size: 0.9, mps: 440, length: 1.15 },
  dmr: { size: 1, mps: 620, length: 1.4, kick: 1.3 },
  sniper: { size: 1.15, mps: 1000, length: 1.7, kick: 1.6, vapour: 0.3 },
};
/**
 * A vehicle gun's round. The jeep's is fat and slow and kicks big dust; a tank's machine gun thin, fast and tight, so it never
 * hides the main gun's round; a helicopter's miniguns a rope of fine rounds; a jet's cannon bright bolts that land as small
 * bursts; an AA's twin barrels fire in turn, fast as BF4's, and burst as flak round a target in the air. Anything else fires
 * the base round.
 */
const VEHICLES: Partial<Record<VehicleKind, Round>> = {
  jeep: { size: 1.35, mps: 360, kick: 1.8 },
  tank: { size: 0.7, mps: 600, kick: 0.8 },
  helicopter: { size: 0.6, mps: 900, kick: 0.6, rope: 4 },
  jet: { size: 1.2, mps: 1000, length: 0.8, lands: 'burst' },
  aa: { size: 1, mps: 1100, lands: 'flak', twin: true },
};
export const roundOf = (shooter: Shooter, gun: GunKind = 'rifle'): Round => (shooter === 'foot' ? GUNS[gun] : VEHICLES[shooter]) ?? { size: 1, mps: ROUND_MPS };
/** A round's streak in metres: the base length at its size, longer the faster it flies, so a fast round still reads as a line. */
export const roundLength = (r: Round) => ROUND_LENGTH_M * r.size * (r.length ?? 1) * Math.sqrt(r.mps / ROUND_MPS);

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

/** What a round throws up: dust, sparks and a ricochet; a small shell's flash (`burst`, with dust of its own); a flak puff hanging in the air. */
export type KickKind = 'dust' | 'spark' | 'ricochet' | 'burst' | 'flak';
/** How long each lasts, in ms. */
export const KICK_MS: Record<KickKind, number> = { dust: 650, spark: 200, ricochet: 130, burst: 110, flak: 1800 };

export interface Kick {
  kind: KickKind;
  x: number;
  y: number;
  at: number;
  /** A spark's or ricochet's heading in radians and speed in m/s. */
  angle: number;
  speed: number;
  /** How big it is next to a rifle round's. */
  scale: number;
}

/**
 * What a round kicks up when it lands at `to`, flying along `heading` (radians): sparks thrown back on a hit, a dust puff on
 * a miss and, one miss in six, a ricochet glancing on; a round that `lands` as a burst flashes and throws more dust, and one
 * that lands as flak leaves its puff, hit or miss, when its target is in the air (`aloft`). `random` is 0..1.
 */
export function landing(to: Vec2, heading: number, hit: boolean, at: number, random: () => number, round: Round = { size: 1, mps: ROUND_MPS }, aloft = false): Kick[] {
  const scale = round.kick ?? 1;
  const kick = (kind: KickKind, angle = 0, speed = 0, size = scale): Kick => ({ kind, x: to.x, y: to.y, at, angle, speed, scale: size });
  if (round.lands === 'flak' && aloft) return [kick('burst'), kick('flak')];
  if (round.lands === 'burst') return [kick('burst', 0, 0, 1.4), kick('dust', 0, 0, 1.8), ...(hit ? [0, 1].map(() => kick('spark', heading + Math.PI + (random() - 0.5) * 2.2, 20 + random() * 35)) : [])];
  if (hit) return [0, 1, 2, 3].map(() => kick('spark', heading + Math.PI + (random() - 0.5) * 2.2, (20 + random() * 35) * Math.sqrt(scale)));
  const out = [kick('dust')];
  if (random() < 1 / 6) out.push(kick('ricochet', heading + (random() - 0.5) * 1.8, 200));
  return out;
}

/** A dust puff `age` ms old: its radius in metres and its opacity. Null once gone. */
export function puffAt(age: number, scale = 1): { radius: number; opacity: number } | null {
  const k = age / KICK_MS.dust;
  if (k < 0 || k >= 1) return null;
  return { radius: (0.7 + 2.6 * Math.sqrt(k)) * scale, opacity: 0.34 * (1 - k) };
}

/** A burst's flash or a flak puff `age` ms old: its radius in metres and its opacity. Null once gone. */
export function burstAt(k: Kick, age: number): { radius: number; opacity: number } | null {
  if (k.kind !== 'burst' && k.kind !== 'flak') return null;
  const life = age / KICK_MS[k.kind];
  if (life < 0 || life >= 1) return null;
  return k.kind === 'burst' ? { radius: (1 + 2.2 * life) * k.scale, opacity: 0.95 * (1 - life) } : { radius: (1.2 + 2.4 * Math.sqrt(life)) * k.scale, opacity: 0.5 * (1 - life) };
}

/** A sniper round's vapour hangs this long along its path. */
export const VAPOUR_MS = 800;
/** A heavy gun's muzzle flash lasts this long. */
export const MUZZLE_MS = 70;
/** A twin gun's barrels sit this far either side of its centre line, in metres. */
export const TWIN_M = 0.9;
/** A rope's rounds leave this far apart, in ms, and land scattered this far round the aim, in metres. */
export const ROPE_GAP_MS = 28;
export const ROPE_SCATTER_M = 1.6;

/** A spark or ricochet `age` ms old: how far its tail and head are from where it started, in metres, and its opacity. Null once gone. */
export function sparkAt(k: Kick, age: number): { tail: number; head: number; opacity: number } | null {
  if (k.kind !== 'spark' && k.kind !== 'ricochet') return null;
  const life = age / KICK_MS[k.kind];
  if (life < 0 || life >= 1) return null;
  const head = (k.speed * age) / 1000;
  return { tail: Math.max(0, head - (k.kind === 'ricochet' ? 8 : 2.3)), head, opacity: 0.9 * (1 - life) };
}
