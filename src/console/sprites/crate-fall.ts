// A baked crate coming down under its canopy, then on the ground (#53 the Supply Drop, #142 the Redeploy Beacon): the swing
// frames hang it north-east of its spot by altitude, its shadow south-west of it, both closing in as it descends. Names no
// Asset: each one's module passes its own sheet's layout.
import type { Vec2 } from '../../sim/types';
import { SHADOW_DIR } from './sheet';

/** Height a crate starts falling from; the canopy comes down at a steady rate. */
const DROP_HEIGHT_M = 30;
/** One full pendulum swing under the canopy. */
const SWING_SECONDS = 3.2;
const LIFT_PER_M = 0.3;
const SHADOW_PER_M = 0.12;

/** A sheet's crate layout, from its bake: the world size of a frame, how far the falling frames hang the crate off-centre, its frames. */
export interface CrateLook {
  worldM: number;
  crateOffsetM: number;
  swingFrames: number;
  landedFrame: number;
}

export interface CratePose {
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
 * Pose of a crate from its view data: while `landsIn` > 0 it hangs under its canopy, drawn north-east of its spot by altitude
 * with its shadow south-west of it, both closing in as it descends; at 0 it sits on the spot.
 */
export function crateFall(e: { x: number; y: number; landsIn: number; fall: number }, look: CrateLook, exaggeration: number): CratePose {
  const size = look.worldM * exaggeration;
  const high = e.fall > 0 ? Math.max(0, Math.min(1, e.landsIn / e.fall)) : 0;
  if (high === 0) {
    const spot = { x: e.x, y: e.y };
    return { landed: true, ...spot, crate: spot, altitude: 0, size, frame: look.landedFrame, shadow: { ...spot, crate: spot, size, opacity: 0 } };
  }
  const altitude = high * DROP_HEIGHT_M;
  // Frame centre sits north-east of the crate it hangs: undo the baked offset at the drawn scale.
  const off = look.crateOffsetM * exaggeration;
  const lift = altitude * LIFT_PER_M;
  const crate = { x: e.x - SHADOW_DIR.x * lift, y: e.y - SHADOW_DIR.y * lift };
  const drop = altitude * SHADOW_PER_M;
  const shadowCrate = { x: e.x + SHADOW_DIR.x * drop, y: e.y + SHADOW_DIR.y * drop };
  const swing = (e.fall - e.landsIn) / SWING_SECONDS;
  return {
    landed: false,
    x: crate.x + off,
    y: crate.y + off,
    crate,
    altitude,
    size: size * (1 + altitude * 0.005),
    frame: Math.floor((swing - Math.floor(swing)) * look.swingFrames) % look.swingFrames,
    shadow: {
      x: shadowCrate.x + off,
      y: shadowCrate.y + off,
      crate: shadowCrate,
      size: size * (1 + altitude * 0.008),
      opacity: 0.7 - altitude * 0.01,
    },
  };
}
