// Death markers: an X where a Soldier died, fading out over DEATH_MARKER_MS.
import * as THREE from 'three/webgpu';
import type { SideId } from '../../sim/types';
import { COLOR, flat, layer } from '../renderer';
import { session } from '../session';

const DEATH_MARKER_MS = 5000;
const barGeometry = new THREE.PlaneGeometry(1.1, 0.22);
const deathMarkers: { mark: THREE.Group; material: THREE.MeshBasicNodeMaterial; at: number }[] = [];

export const resetMarkers = () => (deathMarkers.length = 0);

export function addDeathMarker(x: number, y: number, side: SideId, at: number) {
  const material = flat(COLOR[side === session.commanderSide ? 'friendly' : 'hostile']);
  material.transparent = true;
  const mark = new THREE.Group();
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(barGeometry, material);
    bar.rotation.z = angle;
    mark.add(bar);
  }
  mark.position.set(x, y, 0.8);
  layer.add(mark);
  deathMarkers.push({ mark, material, at });
}

export function drawDeathMarkers(now: number, scale: number) {
  for (let i = deathMarkers.length - 1; i >= 0; i--) {
    const { mark, material, at } = deathMarkers[i]!;
    const left = 1 - (now - at) / DEATH_MARKER_MS;
    if (left > 0) {
      material.opacity = left;
      mark.scale.setScalar(scale * 0.8);
      continue;
    }
    layer.remove(mark);
    material.dispose();
    deathMarkers.splice(i, 1);
  }
}
