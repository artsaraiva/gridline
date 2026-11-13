// A Barrage shell's impact (#62): the baked explosion flipbook and crater decal, and what one impact shows as it ages.
// A Cruise Missile's (#99) is the same, bigger and held longer; a Creeping Barrage shell's (#138) the same, smaller.
// layers/impacts.ts draws it. Crater cap and smoke fade are Console constants, not Simulation Tune values: they only
// change the look, and the Console has no Tune of its own.
import type { SimEvent } from '../../sim/types';
import type { SpriteSheetSpec } from './sheet';
import { SMOKE_PUFF_VARIANTS } from './smoke-puff';

export const EXPLOSION_FRAMES = 32;
export const EXPLOSION_FPS = 16;
export const EXPLOSION_MS = (EXPLOSION_FRAMES / EXPLOSION_FPS) * 1000;
/** Console look: metres the explosion quad is drawn across (#98: big, well over the kill ring). Not a bake value. */
const EXPLOSION_WORLD_M = 64;
export const CRATER_VARIANTS = 3;
/** Console look: metres the crater decal quad is drawn across. Not a bake value. */
const CRATER_WORLD_M = 13;
/** Console constant: craters kept on the map; past this the oldest is removed. */
export const CRATER_CAP = 60;
/** Console constant: time from impact until its smoke plume has drifted off and faded out. */
export const SMOKE_FADE_MS = 20000;
/** Console constant: wind the plume drifts with, in m/s (east-north-east). */
export const WIND = { x: 0.7, y: 0.25 };
const PLUME_PUFFS = 4;
/** The plume fades in over the explosion's last frames, which fade out under it. */
const HANDOVER_MS = EXPLOSION_MS * 0.35;
/** Console look (#99): a missile's explosion and crater are drawn this much bigger than a shell's, */
const MISSILE_SIZE = 1.8;
/** and its flipbook plays this much slower, so the flash holds. */
const MISSILE_HOLD = 1.5;
/** Console look (#138): a Creeping Barrage shell is lighter: its explosion, crater and dust puff are drawn this much smaller. */
const CREEP_SIZE = 0.6;

export const EXPLOSION_SHEET: SpriteSheetSpec = {
  file: 'munitions/explosion.png',
  frames: EXPLOSION_FRAMES,
  framePx: 256,
  cols: 8,
  constants: { EXPLOSION_FRAMES, EXPLOSION_FPS },
};

export const CRATER_SHEET: SpriteSheetSpec = {
  file: 'munitions/crater.png',
  frames: CRATER_VARIANTS,
  framePx: 128,
  constants: { CRATER_VARIANTS },
};

export type ImpactAsset = Extract<SimEvent, { kind: 'impact' }>['asset'];

export interface ImpactRecord {
  x: number;
  y: number;
  at: number;
  seed: number;
  /** #99: what landed; only a shell leaves a streak (layers/shells.ts). */
  asset: ImpactAsset;
}

/** Records an impact at `at` ms, dropping the oldest past CRATER_CAP. Returns `list`. */
export function recordImpact(list: ImpactRecord[], x: number, y: number, at: number, asset: ImpactAsset): ImpactRecord[] {
  list.push({ x, y, at, seed: (list.at(-1)?.seed ?? -1) + 1, asset });
  if (list.length > CRATER_CAP) list.splice(0, list.length - CRATER_CAP);
  return list;
}

/**
 * Baked sprites are lit from the north-east, so they are never rotated. `flip` mirrors one across the
 * NE-SW diagonal instead, which keeps the sun where it is and doubles the variety.
 */
export interface ImpactSprite {
  x: number;
  y: number;
  size: number;
  frame: number;
  flip: boolean;
  opacity: number;
}

export interface ImpactLook {
  crater: ImpactSprite;
  explosion: ImpactSprite | null;
  plume: ImpactSprite[];
}

const hash = (n: number) => Math.abs(Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1;

/** What one impact shows at `now` ms: the explosion flipbook, then a drifting, fading plume, and a crater that stays. */
export function impactLook(i: ImpactRecord, now: number): ImpactLook {
  const heavy = i.asset === 'missile';
  const light = i.asset === 'creep';
  const big = heavy ? MISSILE_SIZE : light ? CREEP_SIZE : 1;
  const hold = heavy ? MISSILE_HOLD : 1;
  const flashMs = EXPLOSION_MS * hold;
  const handoverMs = HANDOVER_MS * hold;
  const age = Math.max(0, now - i.at);
  const r = hash(i.seed);
  const flip = r < 0.5;
  const crater = { x: i.x, y: i.y, size: big * CRATER_WORLD_M * (0.85 + 0.3 * hash(i.seed + 0.5)), frame: i.seed % CRATER_VARIANTS, flip, opacity: 1 };
  const frame = Math.floor((age / 1000 / hold) * EXPLOSION_FPS);
  const explosion =
    frame < EXPLOSION_FRAMES
      ? { x: i.x, y: i.y, size: big * EXPLOSION_WORLD_M * (0.9 + 0.2 * r), frame, flip: !flip, opacity: Math.min(1, (flashMs - age) / handoverMs) }
      : null;
  const plume: ImpactSprite[] = [];
  if (age < SMOKE_FADE_MS) {
    const s = age / 1000;
    const fadeIn = Math.max(0, Math.min(1, (age - (flashMs - handoverMs)) / handoverMs));
    const life = age / SMOKE_FADE_MS;
    for (let k = 0; k < PLUME_PUFFS; k++) {
      const q = hash(i.seed * 7 + k);
      const a = (k / PLUME_PUFFS) * Math.PI * 2 + q * 1.5;
      const spread = k === 0 ? 0 : 4;
      // Each puff rides the wind a little faster than the last, so the plume stretches out downwind.
      const drift = s * (0.7 + 0.25 * k) * (1 - 0.35 * life);
      plume.push({
        x: i.x + Math.cos(a) * spread + WIND.x * drift,
        y: i.y + Math.sin(a) * spread + WIND.y * drift,
        size: (light ? CREEP_SIZE : 1) * (k === 0 ? 26 : 20) * (1 + 0.8 * Math.sqrt(life)),
        frame: (i.seed + k) % SMOKE_PUFF_VARIANTS,
        flip: q < 0.5,
        opacity: fadeIn * (k === 0 ? 0.52 : 0.42) * (1 - life) ** 1.4,
      });
    }
  }
  return { crater, explosion, plume };
}
