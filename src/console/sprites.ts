// Shared sprite-sheet registry, loader and node materials for baked Asset objects (#53, #61).
import * as THREE from 'three/webgpu';
import { dot, float, floor, materialOpacity, mix, mod, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { CommanderView, MapData, Vec2 } from '../sim/types';

export interface SpriteSheetSpec {
  /** Path under `public/`. */
  file: string;
  /** Total frames packed into the sheet. */
  frames: number;
  /** Width and height of each square frame in pixels. */
  framePx: number;
  /** Columns in the sheet grid; defaults to `frames` (a single-row horizontal strip). */
  cols?: number;
}

export const SHELL_PITCH_FRAMES = 8;
export const SHELL_SHADOW_FRAME = SHELL_PITCH_FRAMES;
/** True world size in metres of the baked artillery shell sprite quad (camera ortho_scale in build.py). */
export const SHELL_WORLD_M = 1.55;
/** Tunable exaggeration factor on the shell's world scale so the 3D object reads clearly at close tactical zoom. */
export const SHELL_EXAGGERATION = 5.5;

const ARC_APEX_RATIO = 0.24;
const ARC_LIFT_PER_M = 0.22;
const ALTITUDE_SCALE_PER_M = 0.0028;
const SHADOW_OFFSET_PER_M = 0.26;
// Kaltenbach's sun sits at azimuth 45 deg (north-east), so shadows fall south-west (-cos 45, -sin 45).
const SHADOW_DIR = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };

export interface ShellInFlight {
  from: Vec2;
  to: Vec2;
  flight: number;
  x: number;
  y: number;
  altitude: number;
  heading: number;
  rotation: number;
  pitchFrame: number;
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
    size,
    shadow: {
      x: x + SHADOW_DIR.x * shadowOff,
      y: y + SHADOW_DIR.y * shadowOff,
      size: baseSize * (0.95 + altitude * 0.0012),
      opacity: Math.max(0.38, 0.78 - altitude * 0.002),
    },
  };
}

export const SMOKE_PUFF_VARIANTS = 4;
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

/** Committed baked Asset sprite sheets under `public/`. Later tickets (#62-#65) add their sheets here. */
export const SPRITE_SHEETS = {
  'artillery-shell': {
    file: 'munitions/artillery-shell.png',
    frames: SHELL_PITCH_FRAMES + 1,
    framePx: 128,
  },
  'smoke-puff': {
    file: 'munitions/smoke-puff.png',
    frames: SMOKE_PUFF_VARIANTS,
    framePx: 128,
  },
} as const satisfies Record<string, SpriteSheetSpec>;

export type SpriteSheetId = keyof typeof SPRITE_SHEETS;

export function sheetDimensions(spec: SpriteSheetSpec): { cols: number; rows: number; width: number; height: number } {
  const cols = spec.cols ?? spec.frames;
  const rows = Math.ceil(spec.frames / cols);
  return { cols, rows, width: cols * spec.framePx, height: rows * spec.framePx };
}

// Same BF4 tablet grade and dark opacity curve as renderer.ts, kept free of top-level DOM/WebGPURenderer init for tests.
const LUMA = vec3(0.2126, 0.7152, 0.0722);
function gradeNode(c: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
  const exposed = c.mul(0.98);
  const tinted = mix(vec3(dot(exposed, LUMA)), exposed, 0.12).mul(vec3(0.68, 0.9, 1.14));
  const contrasted = tinted.div(0.18).pow(1.5).mul(0.18).add(0.003);
  return mix(contrasted, contrasted.div(contrasted.add(1)).mul(2), 0.3);
}
const DARK = float(1).sub(float(1).sub(materialOpacity).pow(2.2));

const textures = new Map<SpriteSheetId, THREE.Texture>();

/** Loads and caches a sprite sheet texture from `public/`. Safe to call synchronously during render. */
export function spriteSheetTexture(id: SpriteSheetId): THREE.Texture {
  let tex = textures.get(id);
  if (tex) return tex;
  const spec = SPRITE_SHEETS[id];
  const { width, height } = sheetDimensions(spec);
  const placeholder = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width, height }) : undefined;
  tex = new THREE.Texture(placeholder);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  if (placeholder) tex.needsUpdate = true;
  textures.set(id, tex);
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    const url = `${import.meta.env?.BASE_URL ?? '/'}${spec.file}`;
    void fetch(url)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b, { imageOrientation: 'flipY' }))
      .then((bitmap) => {
        tex!.dispose();
        tex!.image = bitmap as unknown as HTMLImageElement;
        tex!.needsUpdate = true;
      })
      .catch(() => {});
  }
  return tex;
}

/**
 * Node material sampling one cell of a sprite sheet. Set `frame.value` (0-based) to switch frames.
 * World sprites use the map's tablet grade; `shadow: true` draws a dark ground shadow using the frame's alpha.
 */
export function spriteMaterial(id: SpriteSheetId, opts: { frame?: number; shadow?: boolean; opacity?: number } = {}) {
  const spec = SPRITE_SHEETS[id];
  const { cols, rows } = sheetDimensions(spec);
  const tex = spriteSheetTexture(id);
  const frame = uniform(opts.frame ?? 0);
  const col = mod(frame, cols);
  const row = floor(frame.div(cols));
  const cellUv = vec2(col.add(uv().x).div(cols), float(rows - 1).sub(row).add(uv().y).div(rows));
  const sample = texture(tex, cellUv);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    opacity: opts.opacity ?? 1,
  });
  if (opts.shadow) {
    material.colorNode = vec3(0, 0, 0);
    material.opacityNode = sample.a.mul(DARK);
  } else {
    material.colorNode = gradeNode(sample.rgb);
    material.opacityNode = sample.a.mul(materialOpacity);
  }
  return { material, frame };
}
