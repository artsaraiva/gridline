// Shared sprite-sheet loader and node materials for baked Asset objects (#53, #61, #77). Each baked Asset is one
// module beside this one (its sheet entry and pose maths) plus a layer under `../layers/` that draws it; nothing here
// names an Asset. Kept free of top-level DOM/WebGPURenderer init so the Asset modules stay testable.
import * as THREE from 'three/webgpu';
import { dot, float, floor, materialOpacity, mix, mod, texture, uniform, uv, vec2, vec3 } from 'three/tsl';

export interface SpriteSheetSpec {
  /** Path under `public/`. */
  file: string;
  /** Total frames packed into the sheet. */
  frames: number;
  /** Width and height of each square frame in pixels. */
  framePx: number;
  /** Columns in the sheet grid; defaults to `frames` (a single-row horizontal strip). */
  cols?: number;
  /**
   * Console constants whose value the bake fixes (frame counts, headings, world size of a frame, an offset measured
   * in the scene), keyed as the Blender script writes them under `constants` in the sheet `.json`; sheet.test.ts
   * checks them against it.
   */
  constants?: Record<string, number>;
}

// Kaltenbach's sun sits at azimuth 45 deg (north-east), so shadows fall south-west (-cos 45, -sin 45).
export const SHADOW_DIR = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };

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

const textures = new Map<SpriteSheetSpec, THREE.Texture>();

/** Loads and caches a sprite sheet texture from `public/`. Safe to call synchronously during render. */
export function spriteSheetTexture(spec: SpriteSheetSpec): THREE.Texture {
  let tex = textures.get(spec);
  if (tex) return tex;
  const { width, height } = sheetDimensions(spec);
  const placeholder = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width, height }) : undefined;
  tex = new THREE.Texture(placeholder);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  if (placeholder) tex.needsUpdate = true;
  textures.set(spec, tex);
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
      .catch((err) => console.error(`Sprite sheet ${spec.file} failed to load; it draws blank.`, err));
  }
  return tex;
}

/**
 * Node material sampling one cell of a sprite sheet. Set `frame.value` (0-based) to switch frames.
 * World sprites use the map's tablet grade; `shadow: true` draws a dark ground shadow using the frame's alpha.
 */
export function spriteMaterial(spec: SpriteSheetSpec, opts: { frame?: number; shadow?: boolean; opacity?: number } = {}) {
  const { cols, rows } = sheetDimensions(spec);
  const tex = spriteSheetTexture(spec);
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

const spriteQuad = new THREE.PlaneGeometry(1, 1);

/** A unit-quad sprite mesh; scale it to the frame's world size. `frame.value` picks the frame, `material.opacity` fades it. */
export const spriteMesh = (spec: SpriteSheetSpec, opts?: Parameters<typeof spriteMaterial>[1]) => {
  const { material, frame } = spriteMaterial(spec, opts);
  return Object.assign(new THREE.Mesh(spriteQuad, material), { frame });
};
