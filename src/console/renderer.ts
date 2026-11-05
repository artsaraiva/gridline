// three.js renderer, scene and orthographic map camera, plus the per-match `layer` every map layer draws into.
import * as THREE from 'three/webgpu';
import { dot, float, mix, mrt, uniform, vec3 } from 'three/tsl';
import type { SideId } from '../sim/types';
import { session } from './session';

// The feed palette; console.css carries the same values as CSS variables for the chrome.
export const COLOR = { bone: 0xe8e2c8, friendly: 0x6fd0ff, hostile: 0xff4b3e, amber: 0xffc23d, ink: 0x05090b, ground: 0x454c3e };

export const renderer = new THREE.WebGPURenderer({ antialias: true }); // falls back to WebGL 2 without WebGPU
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f0c);

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

// Everything drawn for one match lives in `layer`, emptied whole when the next match starts.
// ponytail: dropped objects' materials and ring geometries are not disposed; a few dozen leak per match.
export const layer = new THREE.Group();
scene.add(layer);

/** Symbology material: flat colour, and it glows (post.ts blooms whatever writes `glow`). */
export function flat(color: number) {
  const material = new THREE.MeshBasicNodeMaterial({ color, side: THREE.DoubleSide });
  material.mrtNode = mrt({ glow: float(1) });
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
