// Last Known Positions: a hostile diamond outline where a lost Contact was last seen, fading out. (Contacts themselves
// are hostile chevrons, in chevrons.ts.) LKPs carry no id, so meshes are pooled and reused in list order.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, flat, layer } from '../renderer';

const diamondGeometry = new THREE.RingGeometry(0.4, 0.55, 4); // 4 segments starting on +x: a diamond outline
const pool: THREE.Mesh[] = [];

export const resetContacts = () => (pool.length = 0);

/** `scale` is the chevron size in metres. */
export function drawLastKnown(view: CommanderView, scale: number) {
  const list = view.lastKnown ?? [];
  for (let i = 0; i < Math.max(list.length, pool.length); i++) {
    let mesh = pool[i];
    if (!mesh) {
      const material = flat(COLOR.hostile);
      material.transparent = true;
      mesh = new THREE.Mesh(diamondGeometry, material);
      layer.add(mesh);
      pool.push(mesh);
    }
    const lkp = list[i];
    mesh.visible = !!lkp;
    if (!lkp) continue;
    mesh.position.set(lkp.x, lkp.y, 0.9);
    mesh.scale.setScalar(scale);
    (mesh.material as THREE.MeshBasicNodeMaterial).opacity = lkp.fade;
  }
}
