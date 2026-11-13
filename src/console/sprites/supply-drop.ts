// The Supply Drop crate (#53): its baked sheet and its descent under the canopy (crate-fall.ts). layers/supply-drop.ts draws it.
import { crateFall, type CratePose } from './crate-fall';
import type { SpriteSheetSpec } from './sheet';

export const SUPPLY_SWING_FRAMES = 8;
export const SUPPLY_SHADOW_FRAME = SUPPLY_SWING_FRAMES;
export const SUPPLY_LANDED_FRAME = SUPPLY_SWING_FRAMES + 1;
/** True world size in metres of one Supply Drop frame (ORTHO_M in assets/objects/supply-drop/build.py). */
export const SUPPLY_WORLD_M = 9;
/** Tunable exaggeration on the Supply Drop's world scale so crate and canopy read at close tactical zoom. */
export const SUPPLY_EXAGGERATION = 2.2;
/** In the falling frames the crate hangs this far west and south of the frame centre, in frame metres (from the bake's sheet .json). */
export const SUPPLY_CRATE_OFFSET_M = 1.516;

export const SUPPLY_SHEET: SpriteSheetSpec = {
  file: 'objects/supply-drop.png',
  frames: SUPPLY_SWING_FRAMES + 2,
  framePx: 256,
  constants: { SUPPLY_SWING_FRAMES, SUPPLY_WORLD_M, SUPPLY_CRATE_OFFSET_M },
};

/** Pose of a Supply Drop crate from its view data: under its canopy while `landsIn` > 0, then on its spot. */
export const supplyDrop = (e: { x: number; y: number; landsIn: number; fall: number }, exaggeration = SUPPLY_EXAGGERATION): CratePose =>
  crateFall(e, { worldM: SUPPLY_WORLD_M, crateOffsetM: SUPPLY_CRATE_OFFSET_M, swingFrames: SUPPLY_SWING_FRAMES, landedFrame: SUPPLY_LANDED_FRAME }, exaggeration);
