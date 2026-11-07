// The Scan UAV (#53): its baked sheet and its orbit pose. layers/scan-uav.ts draws it.
import type { Vec2 } from '../../sim/types';
import { SHADOW_DIR, type SpriteSheetSpec } from './sheet';

/** Headings baked into the UAV sheet (frame k flies at k * 360 / UAV_HEADINGS deg, 0 = east), so its baked sun stays north-east. */
export const UAV_HEADINGS = 16;
export const UAV_SHADOW_FRAME = UAV_HEADINGS;
/** True world size in metres of the baked UAV sprite quad (camera ortho_scale in build.py; 4.3 m wingspan). */
export const UAV_WORLD_M = 5;
/** Tunable exaggeration factor on the UAV's world scale so it reads at close tactical zoom. */
export const UAV_EXAGGERATION = 3;
const UAV_ORBIT_RAD_PER_S = 0.35;
/** Ground offset of the UAV's shadow along SHADOW_DIR: a stylised altitude, as for the shell. */
const UAV_SHADOW_OFFSET_M = 9;

export const UAV_SHEET: SpriteSheetSpec = {
  file: 'objects/scan-uav.png',
  frames: UAV_HEADINGS + 1,
  framePx: 160,
  constants: { UAV_HEADINGS, UAV_WORLD_M },
};

export interface UavInOrbit {
  x: number;
  y: number;
  heading: number;
  /** Nearest baked heading frame. */
  frame: number;
  /** Remaining rotation (within half a heading step) applied to that frame. */
  rotation: number;
  size: number;
  /** Shadow frame is baked flying east, so it turns by the full heading. */
  shadow: { x: number; y: number; rotation: number };
}

/** Pose of the Scan UAV `seconds` into its counter-clockwise orbit of `radius` around `center`. */
export function scanUav(center: Vec2, radius: number, seconds: number, exaggeration = UAV_EXAGGERATION): UavInOrbit {
  const a = seconds * UAV_ORBIT_RAD_PER_S;
  const x = center.x + Math.cos(a) * radius;
  const y = center.y + Math.sin(a) * radius;
  const heading = a + Math.PI / 2;
  const step = (2 * Math.PI) / UAV_HEADINGS;
  const k = Math.round(heading / step);
  return {
    x,
    y,
    heading,
    frame: ((k % UAV_HEADINGS) + UAV_HEADINGS) % UAV_HEADINGS,
    rotation: heading - k * step,
    size: UAV_WORLD_M * exaggeration,
    shadow: { x: x + SHADOW_DIR.x * UAV_SHADOW_OFFSET_M, y: y + SHADOW_DIR.y * UAV_SHADOW_OFFSET_M, rotation: heading },
  };
}
