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
/** Headings baked per pitch (frame = pitch * SHELL_HEADINGS + heading, heading k at k * 360 / SHELL_HEADINGS deg from east). */
export const SHELL_HEADINGS = 16;
export const SHELL_SHADOW_FRAME = SHELL_PITCH_FRAMES * SHELL_HEADINGS;
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

/** Headings baked into the UAV sheet (frame k flies at k * 360 / UAV_HEADINGS deg, 0 = east), so its baked sun stays north-east. */
export const UAV_HEADINGS = 16;
export const UAV_SHADOW_FRAME = UAV_HEADINGS;
/** True world size in metres of the baked UAV sprite quad (camera ortho_scale in build.py; 4.3 m wingspan). */
export const UAV_WORLD_M = 5;
/** Tunable exaggeration factor on the UAV's world scale so it reads at close tactical zoom. */
export const UAV_EXAGGERATION = 3;
const UAV_ORBIT_RAD_PER_S = 0.35;
/** Ground offset of the UAV's shadow along SHADOW_DIR: a stylised altitude, as for the shell. */
const UAV_SHADOW_OFFSET_M = 9;

export interface UavInOrbit {
  x: number;
  y: number;
  heading: number;
  /** Nearest baked heading frame. */
  frame: number;
  /** Remaining rotation (within half a heading step) applied to that frame. */
  rotation: number;
  size: number;
  /** Shadow frame is baked flying east, so it turns by the full heading. */
  shadow: { x: number; y: number; rotation: number };
}

/** Pose of the Scan UAV `seconds` into its counter-clockwise orbit of `radius` around `center`. */
export function scanUav(center: Vec2, radius: number, seconds: number, exaggeration = UAV_EXAGGERATION): UavInOrbit {
  const a = seconds * UAV_ORBIT_RAD_PER_S;
  const x = center.x + Math.cos(a) * radius;
  const y = center.y + Math.sin(a) * radius;
  const heading = a + Math.PI / 2;
  const step = (2 * Math.PI) / UAV_HEADINGS;
  const k = Math.round(heading / step);
  return {
    x,
    y,
    heading,
    frame: ((k % UAV_HEADINGS) + UAV_HEADINGS) % UAV_HEADINGS,
    rotation: heading - k * step,
    size: UAV_WORLD_M * exaggeration,
    shadow: { x: x + SHADOW_DIR.x * UAV_SHADOW_OFFSET_M, y: y + SHADOW_DIR.y * UAV_SHADOW_OFFSET_M, rotation: heading },
  };
}

export const SUPPLY_SWING_FRAMES = 8;
export const SUPPLY_SHADOW_FRAME = SUPPLY_SWING_FRAMES;
export const SUPPLY_LANDED_FRAME = SUPPLY_SWING_FRAMES + 1;
/** True world size in metres of one Supply Drop frame (ORTHO_M in assets/objects/supply-drop/build.py). */
export const SUPPLY_WORLD_M = 9;
/** Tunable exaggeration on the Supply Drop's world scale so crate and canopy read at close tactical zoom. */
export const SUPPLY_EXAGGERATION = 2.2;
/** In the falling frames the crate hangs this far west and south of the frame centre, in frame metres (from the bake's sheet .json). */
export const SUPPLY_CRATE_OFFSET_M = 1.516;
/** Height the crate starts falling from; the canopy comes down at a steady rate. */
const SUPPLY_DROP_HEIGHT_M = 30;
/** One full pendulum swing under the canopy. */
const SUPPLY_SWING_SECONDS = 3.2;
const SUPPLY_LIFT_PER_M = 0.3;
const SUPPLY_SHADOW_PER_M = 0.12;

export interface SupplyDropPose {
  landed: boolean;
  /** Sprite centre. */
  x: number;
  y: number;
  /** Where the crate itself is drawn (the falling frames hang it off-centre). */
  crate: Vec2;
  altitude: number;
  size: number;
  frame: number;
  shadow: { x: number; y: number; crate: Vec2; size: number; opacity: number };
}

/**
 * Pose of a Supply Drop crate from its view data: while `landsIn` > 0 it hangs under its canopy, drawn north-east of
 * its spot by altitude with its shadow south-west of it, both closing in as it descends; at 0 it sits on the spot.
 */
export function supplyDrop(e: { x: number; y: number; landsIn: number; fall: number }, exaggeration = SUPPLY_EXAGGERATION): SupplyDropPose {
  const size = SUPPLY_WORLD_M * exaggeration;
  const high = e.fall > 0 ? Math.max(0, Math.min(1, e.landsIn / e.fall)) : 0;
  if (high === 0) {
    const spot = { x: e.x, y: e.y };
    return { landed: true, ...spot, crate: spot, altitude: 0, size, frame: SUPPLY_LANDED_FRAME, shadow: { ...spot, crate: spot, size, opacity: 0 } };
  }
  const altitude = high * SUPPLY_DROP_HEIGHT_M;
  // Frame centre sits north-east of the crate it hangs: undo the baked offset at the drawn scale.
  const off = SUPPLY_CRATE_OFFSET_M * exaggeration;
  const lift = altitude * SUPPLY_LIFT_PER_M;
  const crate = { x: e.x - SHADOW_DIR.x * lift, y: e.y - SHADOW_DIR.y * lift };
  const drop = altitude * SUPPLY_SHADOW_PER_M;
  const shadowCrate = { x: e.x + SHADOW_DIR.x * drop, y: e.y + SHADOW_DIR.y * drop };
  const swing = (e.fall - e.landsIn) / SUPPLY_SWING_SECONDS;
  return {
    landed: false,
    x: crate.x + off,
    y: crate.y + off,
    crate,
    altitude,
    size: size * (1 + altitude * 0.005),
    frame: Math.floor((swing - Math.floor(swing)) * SUPPLY_SWING_FRAMES) % SUPPLY_SWING_FRAMES,
    shadow: {
      x: shadowCrate.x + off,
      y: shadowCrate.y + off,
      crate: shadowCrate,
      size: size * (1 + altitude * 0.008),
      opacity: 0.7 - altitude * 0.01,
    },
  };
}

export const EXPLOSION_FRAMES = 32;
export const EXPLOSION_FPS = 16;
export const EXPLOSION_MS = (EXPLOSION_FRAMES / EXPLOSION_FPS) * 1000;
/** World size in metres of the baked explosion quad (1 bake unit = 18 m). */
const EXPLOSION_WORLD_M = 36;
export const CRATER_VARIANTS = 3;
/** World size in metres of the baked crater decal quad (1 bake unit = 5 m). */
const CRATER_WORLD_M = 10;
/** Console constant: craters kept on the map; past this the oldest is removed. */
export const CRATER_CAP = 60;
/** Console constant: time from impact until its smoke plume has drifted off and faded out. */
export const SMOKE_FADE_MS = 20000;
/** Console constant: wind the plume drifts with, in m/s (east-north-east). */
const WIND = { x: 0.7, y: 0.25 };
const PLUME_PUFFS = 4;
/** The plume fades in over the explosion's last frames, which fade out under it. */
const HANDOVER_MS = EXPLOSION_MS * 0.35;

export interface ImpactRecord {
  x: number;
  y: number;
  at: number;
  seed: number;
}

/** Records an impact at `at` ms, dropping the oldest past CRATER_CAP. Returns `list`. */
export function recordImpact(list: ImpactRecord[], x: number, y: number, at: number): ImpactRecord[] {
  list.push({ x, y, at, seed: (list.at(-1)?.seed ?? -1) + 1 });
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
  const age = Math.max(0, now - i.at);
  const r = hash(i.seed);
  const flip = r < 0.5;
  const crater = { x: i.x, y: i.y, size: CRATER_WORLD_M * (0.85 + 0.3 * hash(i.seed + 0.5)), frame: i.seed % CRATER_VARIANTS, flip, opacity: 1 };
  const frame = Math.floor((age / 1000) * EXPLOSION_FPS);
  const explosion =
    frame < EXPLOSION_FRAMES
      ? { x: i.x, y: i.y, size: EXPLOSION_WORLD_M * (0.9 + 0.2 * r), frame, flip: !flip, opacity: Math.min(1, (EXPLOSION_MS - age) / HANDOVER_MS) }
      : null;
  const plume: ImpactSprite[] = [];
  if (age < SMOKE_FADE_MS) {
    const s = age / 1000;
    const fadeIn = Math.max(0, Math.min(1, (age - (EXPLOSION_MS - HANDOVER_MS)) / HANDOVER_MS));
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
        size: (k === 0 ? 18 : 14) * (1 + 0.8 * Math.sqrt(life)),
        frame: (i.seed + k) % SMOKE_PUFF_VARIANTS,
        flip: q < 0.5,
        opacity: fadeIn * (k === 0 ? 0.52 : 0.42) * (1 - life) ** 1.4,
      });
    }
  }
  return { crater, explosion, plume };
}

/** Committed baked Asset sprite sheets under `public/`, each built by its Blender script under `assets/`. */
export const SPRITE_SHEETS = {
  'artillery-shell': {
    file: 'munitions/artillery-shell.png',
    frames: SHELL_SHADOW_FRAME + 1,
    framePx: 128,
    cols: SHELL_HEADINGS,
  },
  'smoke-puff': {
    file: 'munitions/smoke-puff.png',
    frames: SMOKE_PUFF_VARIANTS,
    framePx: 128,
  },
  'scan-uav': {
    file: 'objects/scan-uav.png',
    frames: UAV_HEADINGS + 1,
    framePx: 160,
  },
  'supply-drop': {
    file: 'objects/supply-drop.png',
    frames: SUPPLY_SWING_FRAMES + 2,
    framePx: 256,
  },
  explosion: {
    file: 'munitions/explosion.png',
    frames: EXPLOSION_FRAMES,
    framePx: 256,
    cols: 8,
  },
  crater: {
    file: 'munitions/crater.png',
    frames: CRATER_VARIANTS,
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
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => createImageBitmap(b, { imageOrientation: 'flipY' }))
      .then((bitmap) => {
        tex!.dispose();
        tex!.image = bitmap as unknown as HTMLImageElement;
        tex!.needsUpdate = true;
      })
      .catch((err) => console.error(`Sprite sheet ${spec.file} failed to load; ${id} draws blank.`, err));
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
