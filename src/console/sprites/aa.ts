// The AA (#110): its baked sheet (hull and turret apart, per paint variant, as the tank's) and the pose that turns them, the
// turret laid on its target. layers/aa.ts draws it.
import type { VehicleView } from '../../sim/types';
import type { SpriteSheetSpec } from './sheet';

/** Headings baked per part (heading k at k * 360 / AA_HEADINGS deg from east). */
export const AA_HEADINGS = 16;
/** Paint variants (the FactionPaint material role), each a hull row then a turret row: nato, pact, then the Wreck. */
export const AA_VARIANTS = 3;
/** True world size in metres of one AA frame (ORTHO_M in assets/objects/aa/build.py). */
export const AA_WORLD_M = 12;
/** Tunable exaggeration on the AA's world scale, as the tank's. */
export const AA_EXAGGERATION = 1.6;

export const AA_SHEET: SpriteSheetSpec = {
  file: 'objects/aa.png',
  frames: AA_VARIANTS * 2 * AA_HEADINGS + 2, // the hull shadow and the turret shadow close the sheet
  framePx: 160,
  cols: AA_HEADINGS,
  constants: { AA_HEADINGS, AA_VARIANTS, AA_WORLD_M },
};

interface Part {
  frame: number;
  /** Turn applied to the frame: the remainder past the nearest baked heading (for a shadow, the whole heading). */
  rotation: number;
}

const STEP = (2 * Math.PI) / AA_HEADINGS;

/** Hull and turret frames at their nearest baked headings, so the baked sun stays north-east; shadows are baked facing east. */
export function aaPose(v: VehicleView) {
  const variant = v.wreck ? 2 : v.side === 'nato' ? 0 : 1;
  const part = (row: number, fx: number, fy: number): Part => {
    const heading = Math.atan2(fy, fx);
    const k = Math.round(heading / STEP);
    return { frame: row * AA_HEADINGS + (((k % AA_HEADINGS) + AA_HEADINGS) % AA_HEADINGS), rotation: heading - k * STEP };
  };
  const shadow = AA_SHEET.frames - 2;
  return {
    x: v.x,
    y: v.y,
    size: AA_WORLD_M * AA_EXAGGERATION,
    hull: part(variant * 2, v.fx, v.fy),
    turret: part(variant * 2 + 1, v.tx, v.ty),
    shadow: { hull: { frame: shadow, rotation: Math.atan2(v.fy, v.fx) }, turret: { frame: shadow + 1, rotation: Math.atan2(v.ty, v.tx) } },
  };
}
