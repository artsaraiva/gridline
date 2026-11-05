// Chevrons: one mesh per Soldier, pointing +x before rotation, constant size on screen.
import * as THREE from 'three/webgpu';
import type { CommanderView, FriendlyView, SoldierView } from '../../sim/types';
import { COLOR, flat, layer } from '../renderer';

const chevronShape = new THREE.Shape([
  new THREE.Vector2(0.6, 0),
  new THREE.Vector2(-0.5, 0.5),
  new THREE.Vector2(-0.2, 0),
  new THREE.Vector2(-0.5, -0.5),
]);
const chevronGeometry = new THREE.ShapeGeometry(chevronShape);
const chevrons = new Map<string, THREE.Mesh>();

export const resetChevrons = () => chevrons.clear();

function draw(list: (SoldierView | FriendlyView)[], kind: 'friendly' | 'hostile', seen: Set<string>, scale: number) {
  for (const c of list) {
    const key = `${kind}${c.id}`;
    let mesh = chevrons.get(key);
    if (!mesh) {
      mesh = new THREE.Mesh(chevronGeometry, flat(COLOR[kind]));
      (mesh.material as THREE.MeshBasicNodeMaterial).transparent = true;
      layer.add(mesh);
      chevrons.set(key, mesh);
    }
    mesh.position.set(c.x, c.y, 1);
    mesh.rotation.z = Math.atan2(c.fy, c.fx);
    mesh.scale.setScalar(scale);
    (mesh.material as THREE.MeshBasicNodeMaterial).opacity = 'state' in c && c.state === 'wounded' ? 0.35 : 1;
    seen.add(key);
  }
}

/** Friendlies and Contacts; chevrons of Soldiers missing from the view are hidden. `scale` is the chevron size in metres. */
export function drawChevrons(view: CommanderView, scale: number) {
  const seen = new Set<string>();
  draw(view.friendlies, 'friendly', seen, scale);
  draw(view.contacts, 'hostile', seen, scale);
  for (const [key, mesh] of chevrons) mesh.visible = seen.has(key);
}
