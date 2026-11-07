// The Barrage's artillery shell (#53, #61): its baked sheet, flight arc, ground shadow and smoke trail. layers/shells.ts draws it.
import type { CommanderView, MapData, Vec2 } from '../../sim/types';
import { SHADOW_DIR, type SpriteSheetSpec } from './sheet';
import { SMOKE_PUFF_VARIANTS } from './smoke-puff';

export const SHELL_PITCH_FRAMES = 8;
/** Headings baked per pitch (frame = pitch * SHELL_HEADINGS + heading, heading k at k * 360 / SHELL_HEADINGS deg from east). */
export const SHELL_HEADINGS = 16;
export const SHELL_SHADOW_FRAME = SHELL_PITCH_FRAMES * SHELL_HEADINGS;
/** True world size in metres of the baked artillery shell sprite quad (camera ortho_scale in build.py). */
export const SHELL_WORLD_M = 1.55;
/** Tunable exaggeration factor on the shell's world scale so the 3D object reads clearly at close tactical zoom. */
export const SHELL_EXAGGERATION = 5.5;

export const SHELL_SHEET: SpriteSheetSpec = {
  file: 'munitions/artillery-shell.png',
  frames: SHELL_SHADOW_FRAME + 1,
  framePx: 128,
  cols: SHELL_HEADINGS,
  constants: { SHELL_PITCH_FRAMES, SHELL_HEADINGS, SHELL_WORLD_M },
};

const ARC_APEX_RATIO = 0.24;
const ARC_LIFT_PER_M = 0.22;
const ALTITUDE_SCALE_PER_M = 0.0028;
const SHADOW_OFFSET_PER_M = 0.26;

export interface ShellInFlight {
  from: Vec2;
  to: Vec2;
  flight: number;
  x: number;
  y: number;
  altitude: number;
  heading: number;
  /** Full turn from the baked nose-north pose: used by the shadow and the tactical icon. */
  rotation: number;
  pitchFrame: number;
  /** Body sheet frame: the pitch row at the nearest baked heading, so the baked sun stays north-east. */
  frame: number;
  /** Remaining turn (within half a heading step) applied to the body frame. */
  bodyRotation: number;
  size: number;
  shadow: { x: number; y: number; size: number; opacity: number };
}

/** Pose, pitch frame, world scale and ground shadow for one artillery shell at `flight` (0..1) from `from` to `to`. */
export function shellInFlight(from: Vec2, to: Vec2, flight: number, exaggeration = SHELL_EXAGGERATION): ShellInFlight {
  const u = Math.max(0, Math.min(1, flight));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const apex = dist * ARC_APEX_RATIO;
  const altitude = apex * 4 * u * (1 - u);
  const gx = from.x + dx * u;
  const gy = from.y + dy * u;
  const x = gx - SHADOW_DIR.x * altitude * ARC_LIFT_PER_M;
  const y = gy - SHADOW_DIR.y * altitude * ARC_LIFT_PER_M;
  const heading = Math.atan2(dy, dx);
  const rotation = heading - Math.PI / 2;
  const pitchFrame = Math.min(SHELL_PITCH_FRAMES - 1, Math.floor(u * SHELL_PITCH_FRAMES));
  const step = (2 * Math.PI) / SHELL_HEADINGS;
  const k = Math.round(heading / step);
  const frame = pitchFrame * SHELL_HEADINGS + (((k % SHELL_HEADINGS) + SHELL_HEADINGS) % SHELL_HEADINGS);
  const baseSize = SHELL_WORLD_M * exaggeration;
  const size = baseSize * (1 + altitude * ALTITUDE_SCALE_PER_M);
  const shadowOff = altitude * SHADOW_OFFSET_PER_M;
  return {
    from,
    to,
    flight: u,
    x,
    y,
    altitude,
    heading,
    rotation,
    pitchFrame,
    frame,
    bodyRotation: heading - k * step,
    size,
    shadow: {
      x: x + SHADOW_DIR.x * shadowOff,
      y: y + SHADOW_DIR.y * shadowOff,
      size: baseSize * (0.95 + altitude * 0.0012),
      opacity: Math.max(0.38, 0.78 - altitude * 0.002),
    },
  };
}

/** Ground distance between trail puffs, so the trail is equally dense for near and far targets. */
const PUFF_SPACING_M = 1.5;
/** Flight fraction the newest puff trails behind the shell, so it starts at the tail fins. */
const TRAIL_GAP = 0.008;
/** Flight fraction each puff lives before it has fully faded (~0.9 s at the 4 s flight). */
export const TRAIL_PUFF_LIFE = 0.22;
const PUFF_START_M = 4.5;
const PUFF_END_M = 9;
const PUFF_OPACITY = 0.9;

export interface TrailPuff {
  id: number;
  emitted: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  frame: number;
}

/**
 * Smoke puffs left along the path a shell has already flown, oldest first. Stateless: each puff is
 * emitted at a fixed flight fraction, stays where the shell was then, and swells and fades with age.
 */
export function shellTrail(from: Vec2, to: Vec2, flight: number): TrailPuff[] {
  const u = Math.max(0, Math.min(1, flight));
  const out: TrailPuff[] = [];
  const step = PUFF_SPACING_M / Math.max(PUFF_SPACING_M, Math.hypot(to.x - from.x, to.y - from.y));
  const first = Math.max(1, Math.ceil((u - TRAIL_PUFF_LIFE) / step));
  for (let k = first; k * step <= u - TRAIL_GAP; k++) {
    const emitted = k * step;
    const age = (u - emitted) / TRAIL_PUFF_LIFE;
    if (age >= 1) continue;
    const at = shellInFlight(from, to, emitted);
    // Deterministic per-puff jitter so the trail reads as billowing smoke, not a row of beads.
    const r = Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1;
    out.push({
      id: k,
      emitted,
      x: at.x,
      y: at.y,
      size: (PUFF_START_M + (PUFF_END_M - PUFF_START_M) * Math.sqrt(age)) * (0.8 + 0.4 * r),
      opacity: PUFF_OPACITY * (1 - age ** 1.5),
      frame: k % SMOKE_PUFF_VARIANTS,
    });
  }
  return out;
}

/** Friendly barrage shells currently in flight in `view`, arcing from the Commander's own HQ. */
export function barrageShells(view: CommanderView, map: MapData, exaggeration = SHELL_EXAGGERATION): ShellInFlight[] {
  const hq = map.hqs[view.side];
  const from = { x: hq.x, y: hq.y };
  const out: ShellInFlight[] = [];
  for (const e of view.effects ?? []) {
    if (e.asset !== 'barrage') continue;
    for (const s of e.shells ?? []) {
      out.push(shellInFlight(from, { x: s.x, y: s.y }, s.flight, exaggeration));
    }
  }
  return out;
}
