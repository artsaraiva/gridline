// The Cruise Missile (#99): its baked sheet, level flight and dive, and its contrail. layers/missile.ts draws it.
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView, EffectView, SideId, Vec2 } from '../../sim/types';
import { SHADOW_DIR, type SpriteSheetSpec } from './sheet';

/** Pitch rows baked per Faction: 0 = level cruise, the rest nosing down into the target. */
export const MISSILE_PITCH_FRAMES = 4;
/** Headings baked per pitch (heading k at k * 360 / MISSILE_HEADINGS deg from east). */
export const MISSILE_HEADINGS = 16;
/** Faction rows (the FactionPaint material role), in SIDES order: nato, then pact. */
export const MISSILE_FACTIONS = 2;
export const MISSILE_SHADOW_FRAME = MISSILE_FACTIONS * MISSILE_PITCH_FRAMES * MISSILE_HEADINGS;
/** True world size in metres of the baked missile sprite quad (camera ortho_scale in build.py). */
export const MISSILE_WORLD_M = 6.5;
/** Tunable exaggeration on the missile's world scale so it reads at close tactical zoom. */
export const MISSILE_EXAGGERATION = 2.5;

export const MISSILE_SHEET: SpriteSheetSpec = {
  file: 'munitions/cruise-missile.png',
  frames: MISSILE_SHADOW_FRAME + 1,
  framePx: 128,
  cols: MISSILE_HEADINGS,
  constants: { MISSILE_PITCH_FRAMES, MISSILE_HEADINGS, MISSILE_FACTIONS, MISSILE_WORLD_M },
};

/** It flies level at this stylised altitude, and pitches down into the target over the last MISSILE_DIVE_M. */
const CRUISE_ALTITUDE_M = 50;
export const MISSILE_DIVE_M = 60;
const ALTITUDE_LIFT_PER_M = 0.22;
/** The contrail reaches this many seconds of flight back from the missile. */
const TRAIL_S = 8;

/** The missile part of an EffectView; the enemy's is in the view too (it is in the sky). */
export interface MissileView {
  from: Vec2;
  x: number;
  y: number;
  /** The zone ring, in metres. */
  radius: number;
  flight: number;
  /** Seconds the effect has left; after the hit, how long the contrail still hangs. */
  left: number;
  side: SideId;
}

export interface MissileInFlight {
  from: Vec2;
  to: Vec2;
  flight: number;
  side: SideId;
  /** Sprite centre, lifted north-east of the ground by altitude. */
  x: number;
  y: number;
  /** The spot on the ground under it. */
  ground: Vec2;
  altitude: number;
  heading: number;
  pitchFrame: number;
  /** Body sheet frame: the Faction's pitch row at the nearest baked heading, so the baked sun stays north-east. */
  frame: number;
  /** Remaining turn (within half a heading step) applied to the body frame. */
  bodyRotation: number;
  size: number;
  /** Shadow frame is baked flying east, so it turns by the full heading. */
  shadow: { x: number; y: number; rotation: number };
}

/** Pose, frame and world scale of a missile `flight` (0..1) of the way from `from` to its spot. */
export function missileInFlight(e: MissileView, exaggeration = MISSILE_EXAGGERATION): MissileInFlight {
  const to = { x: e.x, y: e.y };
  const u = Math.max(0, Math.min(1, e.flight));
  const dx = to.x - e.from.x;
  const dy = to.y - e.from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ground = { x: e.from.x + dx * u, y: e.from.y + dy * u };
  const remaining = dist * (1 - u);
  const dive = Math.max(0, Math.min(1, 1 - remaining / MISSILE_DIVE_M)); // 0 level, 1 at the target
  const altitude = CRUISE_ALTITUDE_M * (1 - dive);
  const heading = Math.atan2(dy, dx);
  const step = (2 * Math.PI) / MISSILE_HEADINGS;
  const k = Math.round(heading / step);
  const pitchFrame = Math.round(dive * (MISSILE_PITCH_FRAMES - 1));
  const faction = e.side === 'nato' ? 0 : 1;
  return {
    from: e.from,
    to,
    flight: u,
    side: e.side,
    x: ground.x - SHADOW_DIR.x * altitude * ALTITUDE_LIFT_PER_M,
    y: ground.y - SHADOW_DIR.y * altitude * ALTITUDE_LIFT_PER_M,
    ground,
    altitude,
    heading,
    pitchFrame,
    frame: (faction * MISSILE_PITCH_FRAMES + pitchFrame) * MISSILE_HEADINGS + (((k % MISSILE_HEADINGS) + MISSILE_HEADINGS) % MISSILE_HEADINGS),
    bodyRotation: heading - k * step,
    size: MISSILE_WORLD_M * exaggeration,
    shadow: { x: ground.x, y: ground.y, rotation: heading },
  };
}

export interface Trail {
  tail: Vec2;
  head: Vec2;
  length: number;
  angle: number;
  /** 1 in flight; after the hit it hangs and fades to 0 as the effect runs out. */
  opacity: number;
}

/**
 * The contrail: a line along the flown path from TRAIL_S seconds behind the missile (at `speedMps`, never before the
 * launch point) to where it is now, at its altitude; the shell's streak with a longer life. After the hit it hangs
 * over the target and fades with `left`.
 */
export function missileTrail(p: MissileInFlight, left: number, speedMps = DEFAULT_TUNE.missileSpeedMps): Trail {
  const dx = p.to.x - p.from.x;
  const dy = p.to.y - p.from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const flown = dist * p.flight;
  const back = Math.min(flown, TRAIL_S * speedMps);
  const tail = { x: p.x - (dx / dist) * back, y: p.y - (dy / dist) * back };
  // The tail stays at cruise height: it was laid before the dive
  if (p.altitude < CRUISE_ALTITUDE_M) {
    const up = (CRUISE_ALTITUDE_M - p.altitude) * ALTITUDE_LIFT_PER_M;
    tail.x -= SHADOW_DIR.x * up;
    tail.y -= SHADOW_DIR.y * up;
  }
  const head = { x: p.x, y: p.y };
  return { tail, head, length: Math.hypot(head.x - tail.x, head.y - tail.y), angle: Math.atan2(head.y - tail.y, head.x - tail.x), opacity: p.flight < 1 ? 1 : Math.max(0, Math.min(1, left / DEFAULT_TUNE.barrageContactSeconds)) };
}

/** Every missile in `view`, the enemy's included: in the air while `flight` < 1, then its hanging contrail until `left` runs out. */
export function missiles(view: CommanderView): MissileView[] {
  return (view.effects ?? []).flatMap((e): MissileView[] => (isMissile(e) ? [e] : []));
}

const isMissile = (e: EffectView): e is EffectView & MissileView => e.asset === 'missile' && !!e.from && e.flight !== undefined && !!e.side;
