// The Redeploy Beacon crate (#142): its baked sheet, its descent under the canopy (crate-fall.ts) and the blinking lamp on
// its mast once it is down. layers/beacon.ts draws it.
import type { Vec2 } from '../../sim/types';
import { crateFall, type CratePose } from './crate-fall';
import type { SpriteSheetSpec } from './sheet';

export const BEACON_SWING_FRAMES = 8;
export const BEACON_SHADOW_FRAME = BEACON_SWING_FRAMES;
export const BEACON_LANDED_FRAME = BEACON_SWING_FRAMES + 1;
/** True world size in metres of one beacon frame (ORTHO_M in assets/objects/beacon/build.py). */
export const BEACON_WORLD_M = 8;
/** In the falling frames the case hangs this far west and south of the frame centre, in frame metres (from the bake's sheet .json). */
export const BEACON_CRATE_OFFSET_M = 1.166;
/** The lamp on top of the mast, east and north of the landed case's centre, in frame metres (MAST_AT in build.py). */
export const BEACON_LAMP_X_M = 0.38;
export const BEACON_LAMP_Y_M = 0.22;
/** Tunable exaggeration on the beacon's world scale, as the Supply Drop's, so case and mast read at close tactical zoom. */
export const BEACON_EXAGGERATION = 2.4;
/** The lamp flashes once in each of these. */
const BLINK_SECONDS = 1.2;
/** How long each flash takes to die away. */
const FLASH_SECONDS = 0.3;

export const BEACON_SHEET: SpriteSheetSpec = {
  file: 'objects/beacon.png',
  frames: BEACON_SWING_FRAMES + 2,
  framePx: 256,
  constants: { BEACON_SWING_FRAMES, BEACON_WORLD_M, BEACON_CRATE_OFFSET_M, BEACON_LAMP_X_M, BEACON_LAMP_Y_M },
};

/** Pose of a beacon crate from its view data: under its canopy while `landsIn` > 0, then on its spot. */
export const beaconDrop = (e: { x: number; y: number; landsIn: number; fall: number }, exaggeration = BEACON_EXAGGERATION): CratePose =>
  crateFall(e, { worldM: BEACON_WORLD_M, crateOffsetM: BEACON_CRATE_OFFSET_M, swingFrames: BEACON_SWING_FRAMES, landedFrame: BEACON_LANDED_FRAME }, exaggeration);

/** The landed beacon's lamp at `seconds` (any running clock): where it is drawn and how lit it is, 1 at a flash falling to 0. */
export function beaconLamp(spot: Vec2, seconds: number, exaggeration = BEACON_EXAGGERATION): { x: number; y: number; on: number } {
  const phase = seconds / BLINK_SECONDS;
  const since = (phase - Math.floor(phase)) * BLINK_SECONDS;
  return { x: spot.x + BEACON_LAMP_X_M * exaggeration, y: spot.y + BEACON_LAMP_Y_M * exaggeration, on: Math.max(0, 1 - since / FLASH_SECONDS) };
}
