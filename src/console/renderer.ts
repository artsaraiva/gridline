// three.js renderer, scene and orthographic map camera, plus the per-match `layer` every map layer draws into.
import * as THREE from 'three/webgpu';
import type { SideId } from '../sim/types';
import { session } from './session';

export const COLOR = { bone: 0xe8e2c8, friendly: 0x6fd0ff, hostile: 0xff4b3e, ground: 0x262c22 };

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

// Everything drawn for one match lives in `layer`, emptied whole when the next match starts.
// ponytail: dropped objects' materials and ring geometries are not disposed; a few dozen leak per match.
export const layer = new THREE.Group();
scene.add(layer);

export const flat = (color: number) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
export const sideColor = (s: SideId | null) => (s === null ? COLOR.bone : s === session.commanderSide ? COLOR.friendly : COLOR.hostile);
