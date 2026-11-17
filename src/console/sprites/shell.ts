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
// only from SHELL_VISIBLE_FROM of its flight (the last 2 s of the 4 s): long enough to watch it fall, high and far off at
// first, with its shadow on the ground closing in on where it will land.
export const SHELL_VISIBLE_FROM = 0.5;
const ENTRY_ALTITUDE_M = 420;
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
  /** #138: a Smoke Screen shell: its tail is grey. */
  smoke?: true;
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

/**
 * The thin bright line a falling shell leaves, from its entry spot to where it is now (nothing before it is drawn). With
 * `back`, only the last `back` of its flight: a short tail behind the shell, not a line across the map.
 */
export function shellStreak(from: Vec2, to: Vec2, flight: number, back = 1): ShellStreak {
  const tail = shellInFlight(from, to, Math.max(SHELL_VISIBLE_FROM, flight - back));
  const head = shellInFlight(from, to, flight);
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  return { tail: { x: tail.x, y: tail.y }, head: { x: head.x, y: head.y }, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
}

/** A stretch of a shell's trace through the air, from `a` to `b`. */
export interface TraceSegment {
  a: Vec2;
  b: Vec2;
  opacity: number;
  /** #138: a Smoke Screen shell's: grey. */
  smoke: boolean;
}

/** The trace runs this far back along the flight behind the shell, in this many stretches that fade toward its tail. */
const TRACE_BACK = 0.4;
const TRACE_STEPS = 8;
/** It is this faint while the shell is up and away, and brightens to full from TRACE_BRIGHT_FROM of the flight to the hit. */
const TRACE_FAINT = 0.1;
const TRACE_BRIGHT_FROM = 0.6;

/**
 * Where a shell is at `flight` (0..1) on its whole way from the battery at `from` (its caller's HQ): climbing straight to its
 * sky entry over the first SHELL_VISIBLE_FROM of the flight, then down the drawn fall of `shellInFlight`.
 */
export function shellPath(from: Vec2, to: Vec2, flight: number): Vec2 {
  const u = Math.max(0, Math.min(1, flight));
  const s = shellInFlight(from, to, Math.max(u, SHELL_VISIBLE_FROM));
  const k = Math.min(1, u / SHELL_VISIBLE_FROM);
  return { x: from.x + (s.x - from.x) * k, y: from.y + (s.y - from.y) * k };
}

/**
 * The trace a shell leaves in the air at `flight`: from the battery up and over, faint for most of the way and intensifying
 * as the shell comes down on its target, each stretch fainter toward the tail.
 */
export function shellTrace(from: Vec2, to: Vec2, flight: number, smoke = false): TraceSegment[] {
  const u = Math.max(0, Math.min(1, flight));
  const near = Math.max(0, (u - TRACE_BRIGHT_FROM) / (1 - TRACE_BRIGHT_FROM));
  const strength = TRACE_FAINT + (1 - TRACE_FAINT) * near * near;
  const start = Math.max(0, u - TRACE_BACK);
  const out: TraceSegment[] = [];
  if (u <= start) return out;
  for (let i = 0; i < TRACE_STEPS; i++) {
    const at = (k: number) => shellPath(from, to, start + ((u - start) * k) / TRACE_STEPS);
    out.push({ a: at(i), b: at(i + 1), opacity: strength * ((i + 1) / TRACE_STEPS) ** 1.5, smoke });
  }
  return out;
}

/** The traces of every shell in the air in `view`, from the moment it leaves its caller's battery (as `barrageShells`, without the visible window). */
export function shellTraces(view: CommanderView, map: MapData): TraceSegment[] {
  const out: TraceSegment[] = [];
  for (const e of view.effects ?? []) {
    if (e.asset !== 'barrage' && e.asset !== 'creep' && e.asset !== 'smoke') continue;
    const hq = map.hqs['side' in e ? e.side : view.side];
    for (const s of e.shells) out.push(...shellTrace({ x: hq.x, y: hq.y }, { x: s.x, y: s.y }, s.flight, e.asset === 'smoke'));
  }
  return out;
}

/**
 * The shells in their visible window in `view`: the Barrage's, and (#138) the Creeping Barrage's and the Smoke Screen's, each
 * coming in on the bearing from its caller's HQ (the Commander's own, but for an enemy's in the sky).
 */
export function barrageShells(view: CommanderView, map: MapData, exaggeration = SHELL_EXAGGERATION): ShellInFlight[] {
  const out: ShellInFlight[] = [];
  for (const e of view.effects ?? []) {
    if (e.asset !== 'barrage' && e.asset !== 'creep' && e.asset !== 'smoke') continue;
    const hq = map.hqs['side' in e ? e.side : view.side]; // the Barrage's view names no Side: only its caller's view has it
    const from = { x: hq.x, y: hq.y };
    for (const s of e.shells) {
      if (s.flight >= SHELL_VISIBLE_FROM) out.push({ ...shellInFlight(from, { x: s.x, y: s.y }, s.flight, exaggeration), ...(e.asset === 'smoke' && { smoke: true as const }) });
    }
  }
  return out;
}
