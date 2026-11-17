// Death markers: an X where a Soldier died, stamped in with a blink of light and fading out over DEATH_MARKER_MS.
import * as THREE from 'three/webgpu';
import type { SideId } from '../../sim/types';
import { COLOR, flat, layer, pool } from '../renderer';
import { session } from '../session';
import { soft } from './symbols';

const DEATH_MARKER_MS = 5000;
/** The X lands this much oversized and settles over STAMP_MS; the light under it lasts BLINK_MS. */
const [STAMP, STAMP_MS, BLINK_MS] = [0.7, 150, 200];
const blinks = pool(() => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), soft(COLOR.bone)));
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
    const age = now - at;
    const left = 1 - age / DEATH_MARKER_MS;
    if (left > 0) {
      material.opacity = left;
      mark.scale.setScalar(scale * 0.8 * (1 + STAMP * Math.max(0, 1 - age / STAMP_MS)));
      if (age < BLINK_MS) {
        const b = blinks.next();
        b.position.set(mark.position.x, mark.position.y, 0.79);
        b.scale.setScalar(scale * 2.6);
        b.material.opacity = 0.5 * (1 - age / BLINK_MS);
      }
      continue;
    }
    layer.remove(mark);
    material.dispose();
    deathMarkers.splice(i, 1);
  }
  blinks.end();
}
