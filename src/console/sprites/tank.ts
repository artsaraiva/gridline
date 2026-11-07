// The tank (#107): its baked sheet (hull and turret apart, per paint variant) and the pose that turns them. layers/tank.ts draws it.
import type { SideId, Vec2, VehicleView } from '../../sim/types';
import type { SpriteSheetSpec } from './sheet';

/** Headings baked per part (heading k at k * 360 / TANK_HEADINGS deg from east). */
export const TANK_HEADINGS = 16;
/** Paint variants (the FactionPaint material role), each a hull row then a turret row: nato, pact, then the Wreck. */
export const TANK_VARIANTS = 3;
/** True world size in metres of one tank frame (ORTHO_M in assets/objects/tank/build.py). */
export const TANK_WORLD_M = 12;
/** Tunable exaggeration on the tank's world scale so hull and gun read at close tactical zoom. */
export const TANK_EXAGGERATION = 1.6;

export const TANK_SHEET: SpriteSheetSpec = {
  file: 'objects/tank.png',
  frames: TANK_VARIANTS * 2 * TANK_HEADINGS + 2, // the hull shadow and the turret shadow close the sheet
  framePx: 160,
  cols: TANK_HEADINGS,
  constants: { TANK_HEADINGS, TANK_VARIANTS, TANK_WORLD_M },
};

interface Part {
  frame: number;
  /** Turn applied to the frame: the remainder past the nearest baked heading (for a shadow, the whole heading). */
  rotation: number;
}

export interface TankPose {
  x: number;
  y: number;
  size: number;
  hull: Part;
  turret: Part;
  shadow: { hull: Part; turret: Part };
}

const STEP = (2 * Math.PI) / TANK_HEADINGS;

/** Hull and turret frames at their nearest baked headings, so the baked sun stays north-east; shadows are baked facing east. */
export function tankPose(v: VehicleView, exaggeration = TANK_EXAGGERATION): TankPose {
  const variant = v.wreck ? 2 : v.side === 'nato' ? 0 : 1;
  const part = (row: number, fx: number, fy: number): Part => {
    const heading = Math.atan2(fy, fx);
    const k = Math.round(heading / STEP);
    return { frame: row * TANK_HEADINGS + (((k % TANK_HEADINGS) + TANK_HEADINGS) % TANK_HEADINGS), rotation: heading - k * STEP };
  };
  const shadow = TANK_SHEET.frames - 2;
  return {
    x: v.x,
    y: v.y,
    size: TANK_WORLD_M * exaggeration,
    hull: part(variant * 2, v.fx, v.fy),
    turret: part(variant * 2 + 1, v.tx, v.ty),
    shadow: { hull: { frame: shadow, rotation: Math.atan2(v.fy, v.fx) }, turret: { frame: shadow + 1, rotation: Math.atan2(v.ty, v.tx) } },
  };
}

/** The tactical icon's colour role: the Side's (friendly, hostile), grey-white while nobody is aboard; a Wreck has none. */
export function tankIcon(v: VehicleView, mySide: SideId): 'friendly' | 'hostile' | 'empty' | null {
  if (v.wreck) return null;
  return v.empty ? 'empty' : v.side === mySide ? 'friendly' : 'hostile';
}

/** A main gun round's streak trails this far behind its head. */
export const ROUND_STREAK_M = 12;

/** The streak of a round `flight` (0..1) of the way from `from` to `to`: its centre, length and angle; it starts at the muzzle. */
export function roundStreak(r: { from: Vec2; to: Vec2; flight: number }) {
  const dx = r.to.x - r.from.x;
  const dy = r.to.y - r.from.y;
  const d = Math.hypot(dx, dy) || 1;
  const head = Math.min(1, Math.max(0, r.flight)) * d;
  const length = Math.min(ROUND_STREAK_M, head);
  const mid = head - length / 2;
  return { x: r.from.x + (dx / d) * mid, y: r.from.y + (dy / d) * mid, length, angle: Math.atan2(dy, dx) };
}
