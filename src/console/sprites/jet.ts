// The jet (#110): its baked sheet (one body per paint variant) and the pose that lifts it to the Cruise Missile's altitude
// over its ground shadow while it flies, with its contrail; a Wreck lies flat. layers/jet.ts draws it.
import type { VehicleView } from '../../sim/types';
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
/** Its contrail trails this far behind it, at its altitude: a second's flight. */
export const CONTRAIL_M = 120;

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
  /** Behind it along its heading, at its altitude; none on a Wreck. */
  contrail: { x: number; y: number; length: number; angle: number } | null;
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
    contrail: v.airborne ? { x: x - (v.fx * CONTRAIL_M) / 2, y: y - (v.fy * CONTRAIL_M) / 2, length: CONTRAIL_M, angle: heading } : null,
  };
}
