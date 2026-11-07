// Baked smoke puff variants (#61): the shell's trail and the impact plume both draw them.
import type { SpriteSheetSpec } from './sheet';

export const SMOKE_PUFF_VARIANTS = 4;

export const SMOKE_PUFF_SHEET: SpriteSheetSpec = {
  file: 'munitions/smoke-puff.png',
  frames: SMOKE_PUFF_VARIANTS,
  framePx: 128,
  constants: { SMOKE_PUFF_VARIANTS },
};
