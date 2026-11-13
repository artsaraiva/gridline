// A small baked aircraft flying straight and level (#139: the Drone Strike's drone, the Recon Plane): the nearest baked
// heading of its Faction's row, lifted north-east of its ground shadow to the Cruise Missile's altitude. Names no Asset:
// each one's module passes its own sheet's layout.
import type { SideId, Vec2 } from '../../sim/types';
import { ALTITUDE_LIFT_PER_M, CRUISE_ALTITUDE_M } from './missile';
import { SHADOW_DIR } from './sheet';

export interface LevelFlight {
  /** Body centre as drawn: lifted north-east of the ground by its altitude. */
  x: number;
  y: number;
  heading: number;
  /** Sheet frame: the Faction's row at the nearest baked heading, so the baked sun stays north-east. */
  frame: number;
  /** Remaining turn (within half a heading step) applied to the body frame. */
  rotation: number;
  /** On the ground under it; the shadow frame is baked flying east, so it turns by the whole heading. */
  shadow: { x: number; y: number; rotation: number };
}

/** The lift north-east of the ground that draws `altitude` metres up. */
export const lifted = (p: Vec2, altitude = CRUISE_ALTITUDE_M): Vec2 => ({ x: p.x - SHADOW_DIR.x * altitude * ALTITUDE_LIFT_PER_M, y: p.y - SHADOW_DIR.y * altitude * ALTITUDE_LIFT_PER_M });

/**
 * The pose of an aircraft over the ground spot `craft`, heading along its unit (fx, fy), from a sheet of `headings` frames a
 * Faction row (nato, then pact), `altitude` metres up.
 */
export function levelFlight(craft: { x: number; y: number; fx: number; fy: number }, side: SideId, headings: number, altitude = CRUISE_ALTITUDE_M): LevelFlight {
  const heading = Math.atan2(craft.fy, craft.fx);
  const step = (2 * Math.PI) / headings;
  const k = Math.round(heading / step);
  return {
    ...lifted(craft, altitude),
    heading,
    frame: (side === 'nato' ? 0 : 1) * headings + (((k % headings) + headings) % headings),
    rotation: heading - k * step,
    shadow: { x: craft.x, y: craft.y, rotation: heading },
  };
}

/**
 * How a shot-down aircraft shows over the `seconds` the Simulation keeps it, with `left` of them to go: it falls for the first
 * part, as a thing falls, slowly then fast (`height`: what is left of its altitude, 1 to 0), then fades where it lies.
 */
export function downed(left: number, seconds: number): { height: number; opacity: number } {
  const f = Math.max(0, Math.min(1, 1 - left / seconds));
  const fall = Math.min(1, f / 0.6);
  return { height: 1 - fall * fall, opacity: f < 0.6 ? 1 : Math.max(0, 1 - (f - 0.6) / 0.4) };
}
