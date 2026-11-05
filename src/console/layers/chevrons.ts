// Chevrons: one per Soldier (friendly blue, Contacts hostile red) on a dark halo, pointing +x before rotation,
// constant size on screen.
import * as THREE from 'three/webgpu';
import type { CommanderView, FriendlyView, SoldierView } from '../../sim/types';
import { COLOR, layer } from '../renderer';
import { fading, shade } from './symbols';

const chevronShape = new THREE.Shape([
  new THREE.Vector2(0.65, 0),
  new THREE.Vector2(-0.5, 0.425),
  new THREE.Vector2(-0.225, 0),
  new THREE.Vector2(-0.5, -0.425),
]);
const chevronGeometry = new THREE.ShapeGeometry(chevronShape);
const haloGeometry = chevronGeometry.clone().scale(1.3, 1.35, 1).translate(-0.02, 0, -0.05);
const HALO = 0.75;
const chevrons = new Map<string, { mesh: THREE.Mesh; halo: THREE.MeshBasicNodeMaterial }>();

export const resetChevrons = () => chevrons.clear();

function draw(list: (SoldierView | FriendlyView)[], kind: 'friendly' | 'hostile', seen: Set<string>, scale: number) {
  for (const c of list) {
    const key = `${kind}${c.id}`;
    let chevron = chevrons.get(key);
    if (!chevron) {
      chevron = { mesh: new THREE.Mesh(chevronGeometry, fading(COLOR[kind])), halo: shade(0x000000, HALO) };
      chevron.mesh.add(new THREE.Mesh(haloGeometry, chevron.halo));
      layer.add(chevron.mesh);
      chevrons.set(key, chevron);
    }
    const { mesh, halo } = chevron;
    mesh.position.set(c.x, c.y, 1);
    mesh.rotation.z = Math.atan2(c.fy, c.fx);
    mesh.scale.setScalar(scale);
    const alpha = 'state' in c && c.state === 'wounded' ? 0.35 : 1;
    (mesh.material as THREE.MeshBasicNodeMaterial).opacity = alpha;
    halo.opacity = HALO * alpha;
    seen.add(key);
  }
}

/** Friendlies and Contacts; chevrons of Soldiers missing from the view are hidden. `scale` is the chevron size in metres. */
export function drawChevrons(view: CommanderView, scale: number) {
  const seen = new Set<string>();
  draw(view.friendlies, 'friendly', seen, scale);
  draw(view.contacts, 'hostile', seen, scale);
  for (const [key, { mesh }] of chevrons) mesh.visible = seen.has(key);
}
