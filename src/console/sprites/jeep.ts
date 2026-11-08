// The jeep (#108): its baked sheet (one body per paint variant, no turret) and the pose that turns it. layers/jeep.ts draws it.
import type { VehicleView } from '../../sim/types';
import type { SpriteSheetSpec } from './sheet';

/** Headings baked (heading k at k * 360 / JEEP_HEADINGS deg from east). */
export const JEEP_HEADINGS = 16;
/** Paint variants (the FactionPaint material role), a row each: nato, pact, then the Wreck. */
export const JEEP_VARIANTS = 3;
/** True world size in metres of one jeep frame (ORTHO_M in assets/objects/jeep/build.py). */
export const JEEP_WORLD_M = 6;
/** Tunable exaggeration on the jeep's world scale, as the tank's, so it reads at close tactical zoom. */
export const JEEP_EXAGGERATION = 1.6;

export const JEEP_SHEET: SpriteSheetSpec = {
  file: 'objects/jeep.png',
  frames: JEEP_VARIANTS * JEEP_HEADINGS + 1, // the shadow closes the sheet
  framePx: 160,
  cols: JEEP_HEADINGS,
  constants: { JEEP_HEADINGS, JEEP_VARIANTS, JEEP_WORLD_M },
};

interface Part {
  frame: number;
  /** Turn applied to the frame: the remainder past the nearest baked heading (for the shadow, the whole heading). */
  rotation: number;
}

export interface JeepPose {
  x: number;
  y: number;
  size: number;
  body: Part;
  shadow: Part;
}

const STEP = (2 * Math.PI) / JEEP_HEADINGS;

/** The body frame at its nearest baked heading, so the baked sun stays north-east; the shadow is baked facing east. */
export function jeepPose(v: VehicleView, exaggeration = JEEP_EXAGGERATION): JeepPose {
  const variant = v.wreck ? 2 : v.side === 'nato' ? 0 : 1;
  const heading = Math.atan2(v.fy, v.fx);
  const k = Math.round(heading / STEP);
  return {
    x: v.x,
    y: v.y,
    size: JEEP_WORLD_M * exaggeration,
    body: { frame: variant * JEEP_HEADINGS + (((k % JEEP_HEADINGS) + JEEP_HEADINGS) % JEEP_HEADINGS), rotation: heading - k * STEP },
    shadow: { frame: JEEP_SHEET.frames - 1, rotation: heading },
  };
}
