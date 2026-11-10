// The jet (#110): its baked sheet (one body per paint variant) and the pose that lifts it to the Cruise Missile's altitude
// over its ground shadow while it flies; a Wreck lies flat. Its contrail is a trail of smoke puffs laid along the path it
// flew, each spreading and fading where it was left. layers/jet.ts draws it.
import type { Vec2, VehicleView } from '../../sim/types';
import { aloft } from './missile';
import type { SpriteSheetSpec } from './sheet';

/** Headings baked (heading k at k * 360 / JET_HEADINGS deg from east). */
export const JET_HEADINGS = 16;
/** Paint variants (the FactionPaint material role), a row each: nato, pact, then the Wreck. */
export const JET_VARIANTS = 3;
/** True world size in metres of one jet frame (ORTHO_M in assets/objects/jet/build.py). */
export const JET_WORLD_M = 17;
/** Tunable exaggeration on the jet's world scale, as the helicopter's, so it reads at close tactical zoom. */
export const JET_EXAGGERATION = 1.3;
/** The contrail gets a puff every this many metres flown ... */
export const PUFF_EVERY_M = 2.5;
/** ... and each spreads into a cloud and fades out over this long. */
export const CONTRAIL_MS = 3000;
/** A gap longer than this (the jet came into view, or the Console stalled) starts the trail afresh instead of filling it. */
const TRAIL_GAP_M = 200;

const SHADOW = JET_VARIANTS * JET_HEADINGS;

export const JET_SHEET: SpriteSheetSpec = {
  file: 'objects/jet.png',
  frames: SHADOW + 1, // the body shadow closes the sheet
  framePx: 192,
  cols: JET_HEADINGS,
  constants: { JET_HEADINGS, JET_VARIANTS, JET_WORLD_M },
};

interface Part {
  frame: number;
  /** Turn applied to the frame: the remainder past the nearest baked heading (for the shadow, the whole of it). */
  rotation: number;
}

export interface JetPose {
  /** Body centre: lifted north-east of the ground by altitude while it flies. */
  x: number;
  y: number;
  size: number;
  heading: number;
  body: Part;
  /** On the ground under it. */
  shadow: Part & { x: number; y: number };
}

const STEP = (2 * Math.PI) / JET_HEADINGS;

export function jetPose(v: VehicleView): JetPose {
  const variant = v.wreck ? 2 : v.side === 'nato' ? 0 : 1;
  const heading = Math.atan2(v.fy, v.fx);
  const k = Math.round(heading / STEP);
  const { x, y } = v.airborne ? aloft(v) : v;
  return {
    x,
    y,
    size: JET_WORLD_M * JET_EXAGGERATION,
    heading,
    body: { frame: variant * JET_HEADINGS + (((k % JET_HEADINGS) + JET_HEADINGS) % JET_HEADINGS), rotation: heading - k * STEP },
    shadow: { x: v.x, y: v.y, frame: SHADOW, rotation: heading },
  };
}

/** A contrail puff: where the jet was (as drawn, aloft), when (ms), and its number along the trail (for its look). */
export interface Puff extends Vec2 {
  at: number;
  k: number;
}

/**
 * The trail at `now`: faded puffs dropped, and with the jet at `p` (null once it is gone) puffs every `PUFF_EVERY_M` along the
 * way from the last one, so the trail follows its turns whatever the frame rate.
 */
export function layTrail(trail: Puff[], p: Vec2 | null, now: number): Puff[] {
  const kept = trail.filter((q) => now - q.at < CONTRAIL_MS);
  const last = kept.at(-1);
  if (!p) return kept;
  const d = last ? Math.hypot(p.x - last.x, p.y - last.y) : Infinity;
  if (d > TRAIL_GAP_M) return [...kept, { x: p.x, y: p.y, at: now, k: (last?.k ?? 0) + 1 }];
  for (let s = PUFF_EVERY_M; s <= d; s += PUFF_EVERY_M) kept.push({ x: last!.x + ((p.x - last!.x) * s) / d, y: last!.y + ((p.y - last!.y) * s) / d, at: now, k: kept.at(-1)!.k + 1 });
  return kept;
}

/** A puff `age` 0..1 into its life: small and dense just behind the jet, a wide faint cloud at the end. Size in metres. */
export const puffLook = (age: number) => ({ size: 12 + 36 * age, opacity: 0.32 * (1 - age) * Math.sqrt(1 - age) });
