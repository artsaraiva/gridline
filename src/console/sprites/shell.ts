// The Barrage's artillery shell (#53, #61, #98): its baked sheet, sky entry and streak. layers/shells.ts draws it.
import type { CommanderView, MapData, Vec2 } from '../../sim/types';
import { SHADOW_DIR, type SpriteSheetSpec } from './sheet';

export const SHELL_PITCH_FRAMES = 8;
/** Headings baked per pitch (frame = pitch * SHELL_HEADINGS + heading, heading k at k * 360 / SHELL_HEADINGS deg from east). */
export const SHELL_HEADINGS = 16;
export const SHELL_SHADOW_FRAME = SHELL_PITCH_FRAMES * SHELL_HEADINGS;
/** True world size in metres of the baked artillery shell sprite quad (camera ortho_scale in build.py). */
export const SHELL_WORLD_M = 1.55;
/** Tunable exaggeration factor on the shell's world scale: a dark dot a couple of metres across at close tactical zoom. */
export const SHELL_EXAGGERATION = 2;

export const SHELL_SHEET: SpriteSheetSpec = {
  file: 'munitions/artillery-shell.png',
  frames: SHELL_SHADOW_FRAME + 1,
  framePx: 128,
  cols: SHELL_HEADINGS,
  constants: { SHELL_PITCH_FRAMES, SHELL_HEADINGS, SHELL_WORLD_M },
};

// #98: a shell without a visible gun enters the view from the sky, ENTRY_ALTITUDE_M up over a ground spot short of its
// target on the bearing toward the own HQ, and drops to it on a straight line DESCENT_RAD from horizontal. It is drawn
// only from SHELL_VISIBLE_FROM of its flight (the last 0.8 s of the 4 s): a real round falls too fast to watch.
export const SHELL_VISIBLE_FROM = 0.8;
const ENTRY_ALTITUDE_M = 200;
const DESCENT_RAD = Math.PI / 3;
const DESCENT_GROUND_M = ENTRY_ALTITUDE_M / Math.tan(DESCENT_RAD);
const ALTITUDE_LIFT_PER_M = 0.22;
const ALTITUDE_SCALE_PER_M = 0.0028;

export interface ShellInFlight {
  from: Vec2;
  to: Vec2;
  flight: number;
  x: number;
  y: number;
  /** The spot on the ground under the shell. */
  ground: Vec2;
  altitude: number;
  heading: number;
  /** Full turn from the baked nose-north pose. */
  rotation: number;
  pitchFrame: number;
  /** Body sheet frame: the pitch row at the nearest baked heading, so the baked sun stays north-east. */
  frame: number;
  /** Remaining turn (within half a heading step) applied to the body frame. */
  bodyRotation: number;
  size: number;
}

/**
 * Pose, pitch frame and world scale for one artillery shell at `flight` (0..1) into `to`. `from` (the own HQ) only sets
 * the bearing it comes in on: the visible path is the same shape for a near and a far target. Before SHELL_VISIBLE_FROM
 * the pose is held at the entry.
 */
export function shellInFlight(from: Vec2, to: Vec2, flight: number, exaggeration = SHELL_EXAGGERATION): ShellInFlight {
  const u = Math.max(0, Math.min(1, flight));
  const v = Math.max(0, (u - SHELL_VISIBLE_FROM) / (1 - SHELL_VISIBLE_FROM));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const altitude = ENTRY_ALTITUDE_M * (1 - v);
  const gx = to.x - (dx / dist) * DESCENT_GROUND_M * (1 - v);
  const gy = to.y - (dy / dist) * DESCENT_GROUND_M * (1 - v);
  const x = gx - SHADOW_DIR.x * altitude * ALTITUDE_LIFT_PER_M;
  const y = gy - SHADOW_DIR.y * altitude * ALTITUDE_LIFT_PER_M;
  const heading = Math.atan2(dy, dx);
  const rotation = heading - Math.PI / 2;
  const pitchFrame = SHELL_PITCH_FRAMES - 1; // the steepest baked dive, nearest the descent angle
  const step = (2 * Math.PI) / SHELL_HEADINGS;
  const k = Math.round(heading / step);
  const frame = pitchFrame * SHELL_HEADINGS + (((k % SHELL_HEADINGS) + SHELL_HEADINGS) % SHELL_HEADINGS);
  const size = SHELL_WORLD_M * exaggeration * (1 + altitude * ALTITUDE_SCALE_PER_M);
  return {
    from,
    to,
    flight: u,
    x,
    y,
    ground: { x: gx, y: gy },
    altitude,
    heading,
    rotation,
    pitchFrame,
    frame,
    bodyRotation: heading - k * step,
    size,
  };
}

export interface ShellStreak {
  tail: Vec2;
  head: Vec2;
  length: number;
  angle: number;
}

/** The thin bright line a falling shell leaves, from its entry spot to where it is now (nothing before it is drawn). */
export function shellStreak(from: Vec2, to: Vec2, flight: number): ShellStreak {
  const tail = shellInFlight(from, to, SHELL_VISIBLE_FROM);
  const head = shellInFlight(from, to, flight);
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  return { tail: { x: tail.x, y: tail.y }, head: { x: head.x, y: head.y }, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
}

/** Friendly barrage shells in their visible window in `view`, coming in on the bearing from the Commander's own HQ. */
export function barrageShells(view: CommanderView, map: MapData, exaggeration = SHELL_EXAGGERATION): ShellInFlight[] {
  const hq = map.hqs[view.side];
  const from = { x: hq.x, y: hq.y };
  const out: ShellInFlight[] = [];
  for (const e of view.effects ?? []) {
    if (e.asset !== 'barrage') continue;
    for (const s of e.shells ?? []) {
      if (s.flight >= SHELL_VISIBLE_FROM) out.push(shellInFlight(from, { x: s.x, y: s.y }, s.flight, exaggeration));
    }
  }
  return out;
}
