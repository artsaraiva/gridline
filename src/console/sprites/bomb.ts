// A jet's bomb in the air (#110): it leaves the jet at its altitude with the jet's way on it, noses over and comes down on
// its mark, its shadow closing on it from where the jet's was. It is drawn with the artillery shell's baked body and shadow
// (a small dark round, steeper as it falls). layers/bomb.ts draws it; the blast is the shared impact's.
import type { Vec2 } from '../../sim/types';
import { ALTITUDE_LIFT_PER_M, CRUISE_ALTITUDE_M } from './missile';
import { SHADOW_DIR } from './sheet';
import { SHELL_HEADINGS, SHELL_PITCH_FRAMES, SHELL_WORLD_M } from './shell';

/** Console look: the bomb's body next to the shell's baked size, a little bigger while it is high. */
const BOMB_SIZE = 3.2;
const HIGH_SIZE = 0.5;

export interface BombInFlight extends Vec2 {
  /** The spot on the ground under it, for its shadow. */
  ground: Vec2;
  /** 1 as it leaves the jet, 0 as it lands. */
  height: number;
  /** The shell sheet's frame for its dive at the nearest baked heading, and the turn left over. */
  frame: number;
  rotation: number;
  /** Its shadow's full turn (a flat shape). */
  heading: number;
  size: number;
}

/** The bomb `flight` (0..1) of the way from where it left the jet (`from`, on the ground under it) to its mark `to`. */
export function bombInFlight(from: Vec2, to: Vec2, flight: number): BombInFlight {
  const u = Math.max(0, Math.min(1, flight));
  const height = 1 - u * u; // it falls faster and faster
  const ground = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
  const lift = CRUISE_ALTITUDE_M * ALTITUDE_LIFT_PER_M * height;
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const step = (2 * Math.PI) / SHELL_HEADINGS;
  const k = Math.round(heading / step);
  const pitch = Math.min(SHELL_PITCH_FRAMES - 1, Math.floor(u * SHELL_PITCH_FRAMES)); // level as it leaves, nose down as it lands
  return {
    x: ground.x - SHADOW_DIR.x * lift,
    y: ground.y - SHADOW_DIR.y * lift,
    ground,
    height,
    frame: pitch * SHELL_HEADINGS + (((k % SHELL_HEADINGS) + SHELL_HEADINGS) % SHELL_HEADINGS),
    rotation: heading - k * step,
    heading,
    size: SHELL_WORLD_M * BOMB_SIZE * (1 + HIGH_SIZE * height),
  };
}
