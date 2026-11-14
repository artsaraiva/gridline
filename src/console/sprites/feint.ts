// The Feint's dummy paratrooper (#143): its baked sheet, its descent under the canopy (crate-fall.ts, as the Supply crate's),
// and the faint pulse its own Console shows at each burst of its firecrackers once it is down. layers/feint.ts draws it.
import { crateFall, type CratePose } from './crate-fall';
import type { SpriteSheetSpec } from './sheet';

export const FEINT_SWING_FRAMES = 8;
export const FEINT_SHADOW_FRAME = FEINT_SWING_FRAMES;
export const FEINT_LANDED_FRAME = FEINT_SWING_FRAMES + 1;
/** True world size in metres of one frame (ORTHO_M in assets/objects/feint/build.py). */
export const FEINT_WORLD_M = 8;
/** In the falling frames the dummy hangs this far west and south of the frame centre, in frame metres (from the bake's sheet .json). */
export const FEINT_DUMMY_OFFSET_M = 1.016;
/** Tunable exaggeration on its world scale, as the Supply Drop's and the beacon's, so the doll reads at close tactical zoom. */
export const FEINT_EXAGGERATION = 2.4;
/** A burst's pulse runs out to this far from the dummy as it fades ... */
const PULSE_M = 22;
/** ... over this long: well inside the 2 s between bursts, so each reads as its own. */
const PULSE_SECONDS = 1.2;

export const FEINT_SHEET: SpriteSheetSpec = {
  file: 'objects/feint.png',
  frames: FEINT_SWING_FRAMES + 2,
  framePx: 256,
  constants: { FEINT_SWING_FRAMES, FEINT_WORLD_M, FEINT_DUMMY_OFFSET_M },
};

// The tactical icon, in chevrons, filled: a figure hanging under an open canopy. layers/feint.ts draws it on the map beside the
// dummy, chrome/icons.ts in the Asset row (as a path).
export const FEINT_CANOPY: [number, number][] = [[-0.5, 0.18], [-0.44, 0.4], [-0.26, 0.56], [0, 0.62], [0.26, 0.56], [0.44, 0.4], [0.5, 0.18], [0.3, 0.24], [0.1, 0.2], [-0.1, 0.2], [-0.3, 0.24]];
export const FEINT_FIGURE: [number, number][] = [[-0.06, -0.06], [-0.2, -0.24], [-0.15, -0.28], [-0.06, -0.2], [-0.1, -0.6], [-0.03, -0.6], [0, -0.36], [0.03, -0.6], [0.1, -0.6], [0.06, -0.2], [0.15, -0.28], [0.2, -0.24], [0.06, -0.06]];
/** The figure's head, and the two lines up to the canopy's skirt, in the same units. */
export const FEINT_HEAD = { x: 0, y: 0.03, r: 0.09 };
export const FEINT_LINES: [number, number, number, number][] = [[-0.07, -0.04, -0.42, 0.2], [0.07, -0.04, 0.42, 0.2]];

/** Pose of the dummy from its view data: under its canopy while `landsIn` > 0, then on its spot. */
export const feintDrop = (e: { x: number; y: number; landsIn: number; fall: number }, exaggeration = FEINT_EXAGGERATION): CratePose =>
  crateFall(e, { worldM: FEINT_WORLD_M, crateOffsetM: FEINT_DUMMY_OFFSET_M, swingFrames: FEINT_SWING_FRAMES, landedFrame: FEINT_LANDED_FRAME }, exaggeration);

/** The pulse of the burst `burst` seconds ago (the view's `burst`): a ring growing from the dummy as it fades; null between pulses or with none. */
export function feintPulse(burst: number | undefined): { r: number; opacity: number } | null {
  if (burst === undefined || burst < 0 || burst >= PULSE_SECONDS) return null;
  const f = burst / PULSE_SECONDS;
  return { r: PULSE_M * Math.sqrt(f), opacity: (1 - f) * (1 - f) };
}
