// Capture Points: owner ring plus a progress arc toward whichever Side the meter favours.
import * as THREE from 'three/webgpu';
import type { PointView } from '../../sim/types';
import { COLOR, flat, layer, sideColor } from '../renderer';

const rings = new Map<string, { ring: THREE.Mesh; arc: THREE.Mesh; progress: number }>();

export const resetPoints = () => rings.clear();

export function drawPoint(p: PointView) {
  let r = rings.get(p.id);
  if (!r) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius - 1.2, p.radius, 64), flat(COLOR.bone));
    const arc = new THREE.Mesh(new THREE.BufferGeometry(), flat(COLOR.bone));
    ring.position.set(p.x, p.y, 0.2);
    arc.position.set(p.x, p.y, 0.3);
    layer.add(ring, arc);
    r = { ring, arc, progress: NaN };
    rings.set(p.id, r);
  }
  (r.ring.material as THREE.MeshBasicNodeMaterial).color.setHex(sideColor(p.owner));
  if (p.progress === r.progress) return;
  r.progress = p.progress;
  r.arc.geometry.dispose();
  r.arc.geometry = new THREE.RingGeometry(p.radius + 1, p.radius + 4, 64, 1, Math.PI / 2, -Math.abs(p.progress) * Math.PI * 2);
  (r.arc.material as THREE.MeshBasicNodeMaterial).color.setHex(sideColor(p.progress > 0 ? 'nato' : 'pact'));
}
