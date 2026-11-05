// Friendly Squad tags: an APP-6 friendly infantry frame (blue rectangle with the X) and the Squad's name, up and to
// the right of its living members. A wiped Squad has no tag.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, layer } from '../renderer';
import { bar, css, fading, label, px } from './symbols';

const FW = px(18) / 2;
const FH = px(12) / 2;
const LINE = px(1.5);
// the frame, then the name tag, both from px(18) right of and px(22) above the members' centre
const frameGeometries = [
  bar(-FW, -FH, FW, -FH, LINE),
  bar(FW, -FH, FW, FH, LINE),
  bar(FW, FH, -FW, FH, LINE),
  bar(-FW, FH, -FW, -FH, LINE),
  bar(-FW, -FH, FW, FH, LINE),
  bar(-FW, FH, FW, -FH, LINE),
];
const fillGeometry = new THREE.PlaneGeometry(2 * FW, 2 * FH);

const tags = new Map<number, THREE.Group>();

export const resetSquads = () => tags.clear();

function tag(name: string) {
  const group = new THREE.Group();
  const frame = new THREE.Group();
  frame.add(new THREE.Mesh(fillGeometry, fading(COLOR.friendly, 0.18)));
  const stroke = fading(COLOR.friendly);
  for (const g of frameGeometries) frame.add(new THREE.Mesh(g, stroke));
  frame.position.set(px(18) + FW, px(22), 0);
  const text = label(name.toUpperCase(), css(COLOR.friendly), { bg: 'rgba(5,9,11,0.78)', left: true });
  text.position.set(px(40), px(22), 0);
  group.add(frame, text);
  layer.add(group);
  return group;
}

/** `scale` is the symbol unit in metres. */
export function drawSquads(view: CommanderView, scale: number) {
  for (const q of view.squads) {
    const members = view.friendlies.filter((f) => f.squad === q.id);
    let group = tags.get(q.id);
    if (!group) tags.set(q.id, (group = tag(q.name)));
    group.visible = members.length > 0;
    if (!members.length) continue;
    const x = members.reduce((s, m) => s + m.x, 0) / members.length;
    const y = members.reduce((s, m) => s + m.y, 0) / members.length;
    group.position.set(x, y, 1.1);
    group.scale.setScalar(scale);
  }
}
