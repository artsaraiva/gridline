// three.js renderer, scene and orthographic map camera, plus the per-match `layer` every map layer draws into.
import * as THREE from 'three/webgpu';
import { diffuseColor, dot, float, materialOpacity, mix, mrt, uniform, vec3, vec4 } from 'three/tsl';
import type { SideId, Vec2 } from '../sim/types';
import { session } from './session';

// The feed palette; console.css carries the same values as CSS variables for the chrome.
export const COLOR = { bone: 0xe8e2c8, friendly: 0x6fd0ff, hostile: 0xff4b3e, amber: 0xffc23d, ink: 0x05090b, ground: 0x454c3e };

export const renderer = new THREE.WebGPURenderer({ antialias: true }); // falls back to WebGL 2 without WebGPU
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
export const scene = new THREE.Scene();
scene.background = new THREE.Color(COLOR.ink);

// Orthographic camera looking down -z: x east, y north, world units are metres.
const VIEW_M = 680; // world height shown at zoom 1: the whole Play Area
export const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
camera.position.z = 100;
function resize() {
  const aspect = innerWidth / innerHeight;
  camera.left = (-VIEW_M / 2) * aspect;
  camera.right = (VIEW_M / 2) * aspect;
  camera.top = VIEW_M / 2;
  camera.bottom = -VIEW_M / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
resize();
addEventListener('resize', resize);

/** World metres per screen pixel at the current zoom. */
export const pxToWorld = () => (camera.top - camera.bottom) / camera.zoom / innerHeight;
/** `pxToWorld()` for shaders; main.ts sets it every frame. */
export const metresPerPx = uniform(1);
/** Screen px (client coordinates) to world metres, and back. */
export const toWorld = (sx: number, sy: number): Vec2 => ({ x: camera.position.x + (sx - innerWidth / 2) * pxToWorld(), y: camera.position.y - (sy - innerHeight / 2) * pxToWorld() });
export const toScreen = (p: Vec2): Vec2 => ({ x: innerWidth / 2 + (p.x - camera.position.x) / pxToWorld(), y: innerHeight / 2 - (p.y - camera.position.y) / pxToWorld() });

// Everything drawn for one match lives in `layer`, emptied whole when the next match starts.
// ponytail: dropped objects' materials and ring geometries are not disposed; a few dozen leak per match.
export const layer = new THREE.Group();
scene.add(layer);

/** Marks a node material's fragments to glow (post.ts blooms them), as strongly as they are opaque. */
export const GLOW = () => mrt({ glow: vec4(diffuseColor.a) });

// three blends in linear light, so a faint bright fill over the dark map reads far more opaque than the same `opacity`
// in CSS / canvas (the prototypes), and a dark one far less. These curves make `opacity` read as it does there.
// ponytail: exact over a black (BRIGHT) or white (DARK) backdrop only; blend in display space if mid-tones need it.
export const BRIGHT = materialOpacity.pow(2.2);
export const DARK = float(1).sub(float(1).sub(materialOpacity).pow(2.2));

/** Symbology material: flat colour, and it glows. `opacity` reads as it would in CSS. */
export function flat(color: number) {
  const material = new THREE.MeshBasicNodeMaterial({ color, side: THREE.DoubleSide });
  material.opacityNode = BRIGHT;
  material.mrtNode = GLOW();
  return material;
}

/**
 * The BF4 tablet grade (approved on map look-dev) for linear colour: near-grey, cool tint, contrast 1.5 as a power
 * curve around linear mid-grey, slight lift, soft highlight shoulder. The map, sprites and effects take it; symbology
 * keeps the palette.
 */
const LUMA = vec3(0.2126, 0.7152, 0.0722);
export function grade(c: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
  const exposed = c.mul(0.98);
  const tinted = mix(vec3(dot(exposed, LUMA)), exposed, 0.12).mul(vec3(0.68, 0.9, 1.14));
  const contrasted = tinted.div(0.18).pow(1.5).mul(0.18).add(0.003);
  return mix(contrasted, contrasted.div(contrasted.add(1)).mul(2), 0.3);
}
export const sideColor = (s: SideId | null) => (s === null ? COLOR.bone : s === session.commanderSide ? COLOR.friendly : COLOR.hostile);
