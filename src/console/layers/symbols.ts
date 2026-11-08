// Shared APP-6 symbology pieces for the map layers.
//
// DECISION (#43): symbology is drawn in-canvas, as three.js meshes in `layer`, not on a 2D canvas overlay. So the
// feed's post chain (glow, fringe, VHS, bursts) reaches every mark, and there is one renderer. Layers added later
// (#36 Order lines, #37 Asset rings, #40 barrage marks) follow suit:
// - Symbol geometry is in UNITS of UNIT_PX screen pixels; scale the mesh by `scale` (UNIT_PX in metres, from main.ts)
//   each frame to keep it a constant size on screen.
// - Palette colours from `COLOR` with `flat()` (glows); map-like things (sprites, craters, smoke) take `grade()`.
// - World-sized rings use `dashedRing`, which keeps its line and dashes a constant pixel size at any zoom.
// - Text uses `label`.
import * as THREE from 'three/webgpu';
import { abs, atan, float, fract, length, max, mix, positionLocal, smoothstep, step, uniform, uv, vec3 } from 'three/tsl';
import { BRIGHT, COLOR, DARK, flat, GLOW, metresPerPx } from '../renderer';

/** Screen pixels per symbol unit (the chevron size). */
export const UNIT_PX = 14;
/** Screen pixels to symbol units. */
export const px = (n: number) => n / UNIT_PX;

export type Frame = 'friendly' | 'hostile' | 'neutral';
// APP-6 affiliation frames as [segments, start angle, vertex radius per half-size, stroke widening at vertices]
const FRAME: Record<Frame, [number, number, number, number]> = {
  friendly: [4, Math.PI / 4, Math.SQRT2, Math.SQRT2], // rectangle (square for points)
  hostile: [4, 0, 1.15, Math.SQRT2], // diamond
  neutral: [48, 0, 1, 1], // circle
};

/** Outline of an affiliation frame `half` units across from the centre, stroke `w` units. */
export function frameOutline(frame: Frame, half: number, w: number) {
  const [segments, start, r, k] = FRAME[frame];
  return new THREE.RingGeometry(half * r - (w * k) / 2, half * r + (w * k) / 2, segments, 1, start);
}

/** Filled affiliation frame, `half` units across from the centre. */
export function frameFill(frame: Frame, half: number) {
  const [segments, start, r] = FRAME[frame];
  return new THREE.CircleGeometry(half * r, segments, start);
}

/** Merges geometries (non-indexed positions only). */
export function merge(parts: THREE.BufferGeometry[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap((p) => [...(p.toNonIndexed().getAttribute('position').array as Float32Array)]), 3));
  return g;
}

/** Thin bar from (x0, y0) to (x1, y1), `w` units wide; for the infantry X and the like. */
export function bar(x0: number, y0: number, x1: number, y1: number, w: number) {
  const g = new THREE.PlaneGeometry(Math.hypot(x1 - x0, y1 - y0), w);
  g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  return g;
}

/** Plain colour with no glow: the dark halos and fills under symbols. */
export function shade(color: number, opacity: number) {
  const material = new THREE.MeshBasicNodeMaterial({ color, opacity, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.opacityNode = DARK;
  return material;
}

/**
 * A thin bright line on a unit quad, brightest at its head (uv.x = 1) and fading to nothing at its tail: the shell's
 * streak (#98) and the missile's contrail (#99). Scale the quad to length x pixel width; `opacity` fades the whole line.
 */
export function streak(color = COLOR.bone) {
  const material = new THREE.MeshBasicNodeMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.opacityNode = BRIGHT.mul(uv().x.mul(0.15).add(0.85).mul(uv().x.pow(0.6)));
  material.mrtNode = GLOW();
  return material;
}

/** `flat` with opacity, for symbols that fade. */
export function fading(color: number, opacity = 1) {
  const material = flat(color);
  material.transparent = true;
  material.depthWrite = false;
  material.opacity = opacity;
  return material;
}

/**
 * A world-sized dashed ring of `radius` metres whose line, dark halo and dashes stay a constant pixel size.
 * Set `tint.value`, `r.value` or `alpha.value` to update it in place.
 */
export function dashedRing(radius: number, color: number, { dash = 8, gap = 5, width = 1.5, opacity = 0.85 } = {}) {
  const tint = uniform(new THREE.Color(color));
  const r = uniform(radius);
  const alpha = uniform(opacity);
  const p = positionLocal.xy;
  const off = abs(length(p).sub(r)).div(metresPerPx); // px from the ring line
  const along = atan(p.y, p.x).mul(r).div(metresPerPx); // px around the ring
  const on = step(fract(along.div(dash + gap)), dash / (dash + gap));
  const core = float(1).sub(smoothstep(width / 2 - 0.5, width / 2 + 0.5, off));
  const halo = float(1).sub(smoothstep(width / 2 + 0.5, width / 2 + 1.5, off));
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = mix(vec3(0), tint, core);
  material.opacityNode = max(core.mul(alpha.pow(2.2)), halo.mul(0.73)).mul(on); // as flat's BRIGHT / shade's DARK curves
  material.mrtNode = GLOW();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * radius + 16, 2 * radius + 16), material);
  return { mesh, tint, r, alpha };
}

const fontOf = (weight: number, size: number) => `${weight} ${size}px 'Chakra Petch', ui-monospace, monospace`;

/**
 * Text as a mesh in symbol units: `size` px Chakra Petch in `color`, on a `bg` box when given. Centred on the origin,
 * or with its left edge there when `left`. Repaints once the font has loaded.
 */
export function label(text: string, color: string, { size = 13, weight = 700, bg = '', left = false } = {}) {
  const font = fontOf(weight, size);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + (bg ? 10 : 2);
  const h = bg ? 18 : size + 4;
  const k = 2 * devicePixelRatio; // texels per screen px: stays sharp through the fringe
  canvas.width = w * k;
  canvas.height = h * k;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const paint = () => {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);
    texture.needsUpdate = true;
  };
  paint();
  if (!document.fonts.check(font)) void document.fonts.load(font).then(paint);
  const material = new THREE.MeshBasicNodeMaterial({ map: texture, transparent: true, depthWrite: false });
  material.mrtNode = GLOW();
  const geometry = new THREE.PlaneGeometry(px(w), px(h));
  if (left) geometry.translate(px(w) / 2, 0, 0);
  return new THREE.Mesh(geometry, material);
}

/** CSS colour for a `COLOR` value, for `label`. */
export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
