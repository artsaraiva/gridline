// The transport helicopter (#109): its baked sheet (one body per paint variant, the rotor apart), the pose that turns and
// lifts it (the Cruise Missile's altitude and ground-shadow treatment while airborne, flat on the ground), and its climb.
// layers/helicopter.ts draws it.
import type { VehicleView } from '../../sim/types';
import { ALTITUDE_LIFT_PER_M, CRUISE_ALTITUDE_M } from './missile';
import { SHADOW_DIR, type SpriteSheetSpec } from './sheet';

/** Headings baked (heading k at k * 360 / HELI_HEADINGS deg from east). */
export const HELI_HEADINGS = 16;
/** Paint variants (the FactionPaint material role), a row each: nato, pact, then the Wreck. */
export const HELI_VARIANTS = 3;
/** True world size in metres of one helicopter frame (ORTHO_M in assets/objects/helicopter/build.py). */
export const HELI_WORLD_M = 18;
/** Tunable exaggeration on the helicopter's world scale, as the tank's, so it reads at close tactical zoom. */
export const HELI_EXAGGERATION = 1.15;
/** It climbs to and settles from its altitude at this rate, so lift-off and landing read as such. */
const CLIMB_MPS = 20;
/** The spinning rotor's turn rate on screen (layers/helicopter.ts draws the disc's haze under it). */
const ROTOR_RAD_PER_S = 9;

const SHADOW = HELI_VARIANTS * HELI_HEADINGS;
const ROTOR = SHADOW + 1;

export const HELI_SHEET: SpriteSheetSpec = {
  file: 'objects/helicopter.png',
  frames: ROTOR + 1, // the body shadow and the rotor close the sheet
  framePx: 256,
  cols: HELI_HEADINGS,
  constants: { HELI_HEADINGS, HELI_VARIANTS, HELI_WORLD_M },
};

interface Part {
  frame: number;
  /** Turn applied to the frame: the remainder past the nearest baked heading (for the shadow and rotor, the whole of it). */
  rotation: number;
}

export interface HeliPose {
  /** Body and rotor centre: lifted north-east of the ground by altitude. */
  x: number;
  y: number;
  size: number;
  body: Part;
  /** On the ground under it. */
  shadow: Part & { x: number; y: number };
  /** Standing still with nobody aboard, turning (`spinning`, over its disc) with anyone; none on a Wreck. */
  rotor: (Part & { spinning: boolean }) | null;
}

const STEP = (2 * Math.PI) / HELI_HEADINGS;

/** `v` at `altitude` metres (see `climb`), `seconds` into the match for the rotor's turn. */
export function helicopterPose(v: VehicleView, altitude: number, seconds: number): HeliPose {
  const variant = v.wreck ? 2 : v.side === 'nato' ? 0 : 1;
  const heading = Math.atan2(v.fy, v.fx);
  const k = Math.round(heading / STEP);
  const lift = altitude * ALTITUDE_LIFT_PER_M;
  return {
    x: v.x - SHADOW_DIR.x * lift,
    y: v.y - SHADOW_DIR.y * lift,
    size: HELI_WORLD_M * HELI_EXAGGERATION,
    body: { frame: variant * HELI_HEADINGS + (((k % HELI_HEADINGS) + HELI_HEADINGS) % HELI_HEADINGS), rotation: heading - k * STEP },
    shadow: { x: v.x, y: v.y, frame: SHADOW, rotation: heading },
    rotor: v.wreck ? null : v.empty ? { frame: ROTOR, rotation: heading + Math.PI / 4, spinning: false } : { frame: ROTOR, rotation: seconds * ROTOR_RAD_PER_S, spinning: true },
  };
}

/** The altitude `dt` seconds on from `altitude`: up toward the missile's cruise altitude while airborne, down to the ground after. */
export function climb(altitude: number, airborne: boolean, dt: number): number {
  const to = airborne ? CRUISE_ALTITUDE_M : 0;
  const d = to - altitude;
  return Math.abs(d) <= CLIMB_MPS * dt ? to : altitude + Math.sign(d) * CLIMB_MPS * dt;
}
