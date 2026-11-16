// A Barrage shell's impact (#62): the baked explosion flipbook and crater decal, and what one impact shows as it ages.
// A Cruise Missile's (#99) is the same, bigger and held longer; a Creeping Barrage shell's (#138) and a Drone Strike's (#139) the same, smaller.
// Round the flipbook sit the layers that make it a blast: a white flash and the light it throws on the ground, a shock
// ring, debris and embers, dust rolling out, a scorch whose heat cools, and a short kick of the camera.
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
const PLUME_PUFFS = 9;
/** The plume fades in over the explosion's last frames, which fade out under it. */
const HANDOVER_MS = EXPLOSION_MS * 0.35;
/** Console look (#99): a missile's explosion and crater are drawn this much bigger than a shell's, */
const MISSILE_SIZE = 1.8;
/** and its flipbook plays this much slower, so the flash holds. */
const MISSILE_HOLD = 1.5;
/** Console look (#138): a Creeping Barrage shell is lighter: its explosion, crater and dust puff are drawn this much smaller. */
const CREEP_SIZE = 0.6;
/** Console look (#139): a Drone Strike's too, a little less so. */
const DRONE_SIZE = 0.75;

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

/** A soft round glow or dark patch, `size` metres across. */
export interface ImpactGlow {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

/** A streak of debris from tail to head; `heat` runs 1 (white-hot) to 0 (dull orange) as it cools. */
export interface ImpactStreak {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  opacity: number;
  heat: number;
}

export interface ImpactLook {
  crater: ImpactSprite;
  explosion: ImpactSprite | null;
  plume: ImpactSprite[];
  /** The dark patch burned round the crater; it stays, as the crater does. */
  scorch: ImpactGlow;
  /** The heat left in the crater, cooling. */
  heat: ImpactGlow | null;
  /** The white flash of the first frames. */
  flash: ImpactGlow | null;
  /** The warm light the blast throws on the ground round it. */
  light: ImpactGlow | null;
  /** Shock rings running out (one for a shell, two for a missile); `size` is the ring's quad, its line at 0.9 of that. */
  rings: ImpactGlow[];
  /** The dust the blast rolls out along the ground. */
  dust: ImpactGlow | null;
  debris: ImpactStreak[];
  embers: ImpactGlow[];
  /** A missile only: small fires that burn on in the crater. */
  fires: ImpactGlow[];
  /** How hard the camera is kicked now, 1 at the impact falling to 0. */
  kick: number;
}

const hash = (n: number) => Math.abs(Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1;

/** Console look: how long each blast layer lasts for a shell, in ms, and how many pieces it throws; a missile's follow. Judged by eye in the review scene. */
const BLAST = { flash: 90, light: 280, ring: 380, dust: 1300, heat: 2500, kick: 250, debris: 16, embers: 8 };
const HEAVY = { flash: 140, light: 500, ring: 550, dust: 2600, heat: 4000, kick: 500, debris: 34, embers: 14 };
/** A missile's second shock ring leaves this long after the first. */
const RING_GAP_MS = 90;
const FIRES = 4;

/** The blast layers of one impact `age` ms old, sized off its explosion quad, `e` metres across. */
function blast(i: ImpactRecord, age: number, e: number, heavy: boolean) {
  const t = heavy ? HEAVY : BLAST;
  const s = age / 1000;
  const at = (size: number, opacity: number, dx = 0, dy = 0): ImpactGlow => ({ x: i.x + dx, y: i.y + dy, size, opacity });
  const left = (ms: number) => Math.max(0, 1 - age / ms);

  const rings: ImpactGlow[] = [];
  for (let k = 0; k < (heavy ? 2 : 1); k++) {
    const life = (age - k * RING_GAP_MS) / t.ring;
    if (life >= 0 && life < 1) rings.push(at(e * (0.12 + (0.6 + 0.14 * k) * (1 - (1 - life) ** 2.4)), 0.55 * (1 - life)));
  }

  const debris: ImpactStreak[] = [];
  for (let k = 0; k < t.debris; k++) {
    const life = s / ((0.3 + 0.5 * hash(i.seed * 13 + k)) * (heavy ? 1.3 : 1));
    if (life >= 1) continue;
    const a = hash(i.seed * 17 + k) * Math.PI * 2;
    const v = e * (0.55 + hash(i.seed * 19 + k)); // thrown out fast, then held back by drag
    const out = (sec: number) => (v * (1 - Math.exp(-5 * Math.max(0, sec)))) / 5;
    const [d0, d1] = [out(s - 0.035), out(s)];
    debris.push({ x0: i.x + Math.cos(a) * d0, y0: i.y + Math.sin(a) * d0, x1: i.x + Math.cos(a) * d1, y1: i.y + Math.sin(a) * d1, opacity: 1 - life, heat: 1 - life });
  }

  const embers: ImpactGlow[] = [];
  for (let k = 0; k < t.embers; k++) {
    const life = s / (1.1 + 1.3 * hash(i.seed * 23 + k));
    if (life >= 1) continue;
    const a = hash(i.seed * 29 + k) * Math.PI * 2;
    const d = e * (0.04 + 0.11 * hash(i.seed * 31 + k)) * (1 - Math.exp(-2.2 * s));
    embers.push(at(1.1, (1 - life) * (0.6 + 0.4 * Math.sin(s * 30 + k)), Math.cos(a) * d, Math.sin(a) * d));
  }

  const fires: ImpactGlow[] = [];
  if (heavy && s > 0.6)
    for (let k = 0; k < FIRES; k++) {
      const life = 4 + 3 * hash(i.seed * 37 + k);
      if (s >= life) continue;
      const flicker = (0.55 + 0.45 * Math.sin(s * 23 + k * 2.1)) * Math.min(1, (life - s) / 1.5);
      fires.push(at(4, 0.7 * flicker, (hash(i.seed * 41 + k) - 0.5) * e * 0.1, (hash(i.seed * 43 + k) - 0.5) * e * 0.07));
    }

  const dustLife = age / t.dust;
  return {
    scorch: at(e * 0.3, 0.55 * Math.min(1, age / 300)),
    heat: age < t.heat ? at(e * 0.13, 0.75 * left(t.heat)) : null,
    flash: age < t.flash ? at(e * (0.2 + (0.35 * age) / t.flash), 1) : null,
    light: age < t.light ? at(e * 1.3, 0.45 * left(t.light)) : null,
    rings,
    dust: dustLife < 1 ? at(e * (heavy ? 0.8 : 0.55) * (1 - (1 - dustLife) ** 3), 0.22 * (1 - dustLife)) : null,
    debris,
    embers,
    fires,
    kick: left(t.kick),
  };
}

/** What one impact shows at `now` ms: the explosion flipbook, then a drifting, fading plume, and a crater that stays. */
export function impactLook(i: ImpactRecord, now: number): ImpactLook {
  const heavy = i.asset === 'missile';
  const light = i.asset === 'creep' ? CREEP_SIZE : i.asset === 'drone' ? DRONE_SIZE : 1;
  const big = heavy ? MISSILE_SIZE : light;
  const hold = heavy ? MISSILE_HOLD : 1;
  const flashMs = EXPLOSION_MS * hold;
  const handoverMs = HANDOVER_MS * hold;
  const age = Math.max(0, now - i.at);
  const r = hash(i.seed);
  const flip = r < 0.5;
  const crater = { x: i.x, y: i.y, size: big * CRATER_WORLD_M * (0.85 + 0.3 * hash(i.seed + 0.5)), frame: i.seed % CRATER_VARIANTS, flip, opacity: 1 };
  const frame = Math.floor((age / 1000 / hold) * EXPLOSION_FPS);
  const explosionSize = big * EXPLOSION_WORLD_M * (0.9 + 0.2 * r);
  const explosion = frame < EXPLOSION_FRAMES ? { x: i.x, y: i.y, size: explosionSize, frame, flip: !flip, opacity: Math.min(1, (flashMs - age) / handoverMs) } : null;
  const plume: ImpactSprite[] = [];
  if (age < SMOKE_FADE_MS) {
    const s = age / 1000;
    const fadeIn = Math.max(0, Math.min(1, (age - (flashMs - handoverMs)) / handoverMs));
    const life = age / SMOKE_FADE_MS;
    for (let k = 0; k < PLUME_PUFFS; k++) {
      const q = hash(i.seed * 7 + k);
      const a = (k / PLUME_PUFFS) * Math.PI * 2 + q * 1.5;
      const spread = k === 0 ? 0 : 3 + 3 * hash(i.seed * 11 + k);
      // Each puff rides the wind at its own pace and wanders a little across it, so the plume stretches and breaks up downwind.
      const drift = s * (0.7 + 0.14 * k) * (1 - 0.35 * life);
      const wander = Math.sin(s * 0.5 + q * 6) * 1.2 * Math.sqrt(life);
      plume.push({
        x: i.x + Math.cos(a) * spread + WIND.x * drift - WIND.y * wander,
        y: i.y + Math.sin(a) * spread + WIND.y * drift + WIND.x * wander,
        size: light * (k === 0 ? 26 : 15 + 8 * q) * (1 + 0.8 * Math.sqrt(life)),
        frame: (i.seed + k) % SMOKE_PUFF_VARIANTS,
        flip: q < 0.5,
        opacity: fadeIn * (k === 0 ? 0.52 : 0.26 + 0.14 * q) * (1 - life) ** 1.4,
      });
    }
  }
  return { crater, explosion, plume, ...blast(i, age, explosionSize, heavy) };
}
