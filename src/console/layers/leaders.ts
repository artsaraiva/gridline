// Squad Leader star (#71, #54): a small five-point star just north of the leader's chevron on every friendly Squad that
// has one, blue, amber on the selected Squad; nothing while the Squad has no leader (#68: `leader` in the view, Wounded
// or not). Screen-aligned, not rotated with the chevron, at z 1.05: above the chevron (1, whose colour the #70 firing
// pulse changes) and under the tracers.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, layer } from '../renderer';
import { leaderOf } from '../summary';
import { targeting } from '../targeting';
import { fading, px } from './symbols';

const R = px(5.5); // outer radius
const NORTH = px(15); // star centre above the chevron
const starGeometry = new THREE.ShapeGeometry(
  new THREE.Shape(
    Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? R * 0.4 : R;
      return new THREE.Vector2(Math.cos(a) * r, NORTH + Math.sin(a) * r);
    }),
  ),
);

const stars = new Map<number, THREE.Mesh>();

export const resetLeaders = () => stars.clear();

/** `scale` is the symbol unit in metres. */
export function drawLeaders(view: CommanderView, scale: number) {
  for (const m of stars.values()) m.visible = false;
  for (const q of view.squads) {
    const lead = leaderOf(view, q);
    if (!lead) continue;
    let star = stars.get(q.id);
    if (!star) {
      star = new THREE.Mesh(starGeometry, fading(COLOR.friendly));
      layer.add(star);
      stars.set(q.id, star);
    }
    star.visible = true;
    (star.material as THREE.MeshBasicNodeMaterial).color.setHex(targeting.selected === q.id ? COLOR.amber : COLOR.friendly);
    star.position.set(lead.x, lead.y, 1.05);
    star.scale.setScalar(scale);
  }
}
