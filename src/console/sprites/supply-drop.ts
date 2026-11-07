// The Supply Drop crate (#53): its baked sheet and its descent under the canopy. layers/supply-drop.ts draws it.
import type { Vec2 } from '../../sim/types';
import { SHADOW_DIR, type SpriteSheetSpec } from './sheet';

export const SUPPLY_SWING_FRAMES = 8;
export const SUPPLY_SHADOW_FRAME = SUPPLY_SWING_FRAMES;
export const SUPPLY_LANDED_FRAME = SUPPLY_SWING_FRAMES + 1;
/** True world size in metres of one Supply Drop frame (ORTHO_M in assets/objects/supply-drop/build.py). */
export const SUPPLY_WORLD_M = 9;
/** Tunable exaggeration on the Supply Drop's world scale so crate and canopy read at close tactical zoom. */
export const SUPPLY_EXAGGERATION = 2.2;
/** In the falling frames the crate hangs this far west and south of the frame centre, in frame metres (from the bake's sheet .json). */
export const SUPPLY_CRATE_OFFSET_M = 1.516;
/** Height the crate starts falling from; the canopy comes down at a steady rate. */
const SUPPLY_DROP_HEIGHT_M = 30;
/** One full pendulum swing under the canopy. */
const SUPPLY_SWING_SECONDS = 3.2;
const SUPPLY_LIFT_PER_M = 0.3;
const SUPPLY_SHADOW_PER_M = 0.12;

export const SUPPLY_SHEET: SpriteSheetSpec = {
  file: 'objects/supply-drop.png',
  frames: SUPPLY_SWING_FRAMES + 2,
  framePx: 256,
  constants: { SUPPLY_SWING_FRAMES, SUPPLY_WORLD_M, SUPPLY_CRATE_OFFSET_M },
};

export interface SupplyDropPose {
  landed: boolean;
  /** Sprite centre. */
  x: number;
  y: number;
  /** Where the crate itself is drawn (the falling frames hang it off-centre). */
  crate: Vec2;
  altitude: number;
  size: number;
  frame: number;
  shadow: { x: number; y: number; crate: Vec2; size: number; opacity: number };
}

/**
 * Pose of a Supply Drop crate from its view data: while `landsIn` > 0 it hangs under its canopy, drawn north-east of
 * its spot by altitude with its shadow south-west of it, both closing in as it descends; at 0 it sits on the spot.
 */
export function supplyDrop(e: { x: number; y: number; landsIn: number; fall: number }, exaggeration = SUPPLY_EXAGGERATION): SupplyDropPose {
  const size = SUPPLY_WORLD_M * exaggeration;
  const high = e.fall > 0 ? Math.max(0, Math.min(1, e.landsIn / e.fall)) : 0;
  if (high === 0) {
    const spot = { x: e.x, y: e.y };
    return { landed: true, ...spot, crate: spot, altitude: 0, size, frame: SUPPLY_LANDED_FRAME, shadow: { ...spot, crate: spot, size, opacity: 0 } };
  }
  const altitude = high * SUPPLY_DROP_HEIGHT_M;
  // Frame centre sits north-east of the crate it hangs: undo the baked offset at the drawn scale.
  const off = SUPPLY_CRATE_OFFSET_M * exaggeration;
  const lift = altitude * SUPPLY_LIFT_PER_M;
  const crate = { x: e.x - SHADOW_DIR.x * lift, y: e.y - SHADOW_DIR.y * lift };
  const drop = altitude * SUPPLY_SHADOW_PER_M;
  const shadowCrate = { x: e.x + SHADOW_DIR.x * drop, y: e.y + SHADOW_DIR.y * drop };
  const swing = (e.fall - e.landsIn) / SUPPLY_SWING_SECONDS;
  return {
    landed: false,
    x: crate.x + off,
    y: crate.y + off,
    crate,
    altitude,
    size: size * (1 + altitude * 0.005),
    frame: Math.floor((swing - Math.floor(swing)) * SUPPLY_SWING_FRAMES) % SUPPLY_SWING_FRAMES,
    shadow: {
      x: shadowCrate.x + off,
      y: shadowCrate.y + off,
      crate: shadowCrate,
      size: size * (1 + altitude * 0.008),
      opacity: 0.7 - altitude * 0.01,
    },
  };
}
