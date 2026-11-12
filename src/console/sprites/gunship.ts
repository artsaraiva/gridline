// The Gunship (#101): its baked sheet (level and banked bodies per Faction, then a Wreck row), the pose that lifts it to the
// Cruise Missile's altitude over its ground shadow, banked into its turn, left or right (a Wreck lies flat), and its
// shells: each arcs from where the aircraft was when it fired down to where it lands, drawn as the Barrage's round and
// streak. layers/gunship.ts draws it.
import type { EffectView, SideId, Vec2 } from '../../sim/types';
import { ALTITUDE_LIFT_PER_M, CRUISE_ALTITUDE_M } from './missile';
import { SHADOW_DIR, type SpriteSheetSpec } from './sheet';
import { SHELL_EXAGGERATION, SHELL_HEADINGS, SHELL_WORLD_M } from './shell';

/** Headings baked (heading k at k * 360 / GUNSHIP_HEADINGS deg from east). */
export const GUNSHIP_HEADINGS = 16;
/** Rows of the sheet: nato level, pact level, nato banked, pact banked, the Wreck (the FactionPaint material role). */
export const GUNSHIP_ROWS = 5;
/** How far the banked rows roll, the left wing down into a left turn (BANK_DEG in build.py). */
export const GUNSHIP_BANK_DEG = 22;
/** True world size in metres of one frame (ORTHO_M in assets/objects/gunship/build.py; a 40 m span). */
export const GUNSHIP_WORLD_M = 44;

const SHADOW = GUNSHIP_ROWS * GUNSHIP_HEADINGS;
const STEP = (2 * Math.PI) / GUNSHIP_HEADINGS;

export const GUNSHIP_SHEET: SpriteSheetSpec = {
  file: 'objects/gunship.png',
  frames: SHADOW + 1, // the body shadow closes the sheet
  framePx: 192,
  cols: GUNSHIP_HEADINGS,
  constants: { GUNSHIP_HEADINGS, GUNSHIP_ROWS, GUNSHIP_BANK_DEG, GUNSHIP_WORLD_M },
};

// The tactical icon, in chevrons, nose +y: a long fuselage, the straight wide wing with four engines poking ahead of it, the
// tailplane. The right half; the left mirrors it. layers/gunship.ts fills it on the map, chrome/icons.ts in the Asset row.
const HALF: [number, number][] = [
  [0, 0.7], [0.06, 0.62], [0.08, 0.3], [0.2, 0.3], [0.2, 0.4], [0.27, 0.4], [0.27, 0.27], [0.43, 0.25], [0.43, 0.35], [0.5, 0.35],
  [0.5, 0.22], [0.7, 0.2], [0.7, 0.1], [0.08, 0.06], [0.07, -0.44], [0.3, -0.5], [0.3, -0.6], [0.05, -0.6], [0, -0.68],
];
export const GUNSHIP_OUTLINE: [number, number][] = [...HALF, ...HALF.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])];

/** A Gunship to draw: in the air (its EffectView's aircraft) or lying as a Wreck. */
export interface GunshipBody {
  side: SideId;
  craft: { x: number; y: number; fx: number; fy: number; turn?: number };
  wreck?: boolean;
}

interface Part {
  frame: number;
  /** Drawn flipped left to right: the banked rows roll the left wing down, so a right turn is a left one mirrored. */
  mirror?: boolean;
  /** Turn applied to the frame: the remainder past the nearest baked heading (for the shadow, the whole of it). */
  rotation: number;
}

export interface GunshipPose {
  /** Body centre: lifted north-east of the ground by altitude in the air. */
  x: number;
  y: number;
  size: number;
  heading: number;
  body: Part;
  /** On the ground under it. */
  shadow: Part & { x: number; y: number };
}

const lift = (p: Vec2, altitude: number): Vec2 => ({ x: p.x - SHADOW_DIR.x * altitude * ALTITUDE_LIFT_PER_M, y: p.y - SHADOW_DIR.y * altitude * ALTITUDE_LIFT_PER_M });

export function gunshipPose(g: GunshipBody): GunshipPose {
  const faction = g.side === 'nato' ? 0 : 1;
  const turn = g.wreck ? 0 : (g.craft.turn ?? 0);
  const row = g.wreck ? 4 : turn ? 2 + faction : faction;
  const heading = Math.atan2(g.craft.fy, g.craft.fx);
  const mirror = turn < 0;
  const baked = mirror ? Math.PI - heading : heading; // flipped left to right, the frame baked at this heading points along `heading`
  const k = Math.round(baked / STEP);
  const { x, y } = g.wreck ? g.craft : lift(g.craft, CRUISE_ALTITUDE_M);
  return {
    x,
    y,
    size: GUNSHIP_WORLD_M,
    heading,
    body: { frame: row * GUNSHIP_HEADINGS + (((k % GUNSHIP_HEADINGS) + GUNSHIP_HEADINGS) % GUNSHIP_HEADINGS), rotation: mirror ? heading - Math.PI + k * STEP : heading - k * STEP, ...(mirror && { mirror }) },
    shadow: { x: g.craft.x, y: g.craft.y, frame: SHADOW, rotation: heading },
  };
}

/** The artillery shell sheet's pitch rows from level down (build.py PITCH_ANGLES: index 3 is level, 7 the steepest dive). */
const DIVES = [0, 16, 34, 50, 66];

export interface GunshipShell {
  /** Round centre as drawn, lifted by its altitude. */
  x: number;
  y: number;
  /** Where its streak starts: back along the arc, as drawn. */
  tail: Vec2;
  /** Artillery shell sheet frame: the nearest baked dive at the nearest heading. */
  frame: number;
  rotation: number;
  size: number;
}

/**
 * A shell `flight` (0..1) along its arc: over the ground straight from `from` (the aircraft's ground spot as it fired) to its
 * spot, dropping from the aircraft's altitude as a fired round falls (level at the muzzle, steepest at the end).
 */
export function gunshipShell(from: Vec2, to: Vec2, flight: number): GunshipShell {
  const at = (u: number) => {
    const ground = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u };
    return lift(ground, CRUISE_ALTITUDE_M * (1 - u * u));
  };
  const u = Math.max(0, Math.min(1, flight));
  const p = at(u);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const heading = Math.atan2(dy, dx);
  const dive = (Math.atan2(2 * CRUISE_ALTITUDE_M * u, Math.hypot(dx, dy) || 1) * 180) / Math.PI;
  const pitch = 3 + DIVES.reduce((best, d, i) => (Math.abs(d - dive) < Math.abs(DIVES[best]! - dive) ? i : best), 0);
  const step = (2 * Math.PI) / SHELL_HEADINGS;
  const k = Math.round(heading / step);
  return {
    ...p,
    tail: at(Math.max(0, u - 0.3)),
    frame: pitch * SHELL_HEADINGS + (((k % SHELL_HEADINGS) + SHELL_HEADINGS) % SHELL_HEADINGS),
    rotation: heading - k * step,
    size: SHELL_WORLD_M * SHELL_EXAGGERATION,
  };
}

/** The Gunships in the air in `view`'s effects, the enemy's included (the sky rule). */
export const gunshipsInAir = (effects: EffectView[] | undefined) =>
  (effects ?? []).flatMap((e): (GunshipBody & { e: EffectView })[] => (e.asset === 'gunship' && e.craft && e.side ? [{ side: e.side, craft: e.craft, e }] : []));
