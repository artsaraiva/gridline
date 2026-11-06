// Friendly Squad APP-6 frames: a friendly infantry frame (rectangle with the X, amber when selected) up and to the
// right of each Squad's Squad Leader (#68: `leader` in the view, Wounded or not), beside orders.ts's Squad tag. A Squad
// with no leader (wiped, or only Wounded left) has no frame.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, layer } from '../renderer';
import { targeting } from '../targeting';
import { bar, fading, px } from './symbols';

const FW = px(18) / 2;
const FH = px(12) / 2;
const LINE = px(1.5);
const frameGeometries = [
  bar(-FW, -FH, FW, -FH, LINE),
  bar(FW, -FH, FW, FH, LINE),
  bar(FW, FH, -FW, FH, LINE),
  bar(-FW, FH, -FW, -FH, LINE),
  bar(-FW, -FH, FW, FH, LINE),
  bar(-FW, FH, FW, -FH, LINE),
];
const fillGeometry = new THREE.PlaneGeometry(2 * FW, 2 * FH);

type FrameMesh = { group: THREE.Group; fill: THREE.MeshBasicNodeMaterial; stroke: THREE.MeshBasicNodeMaterial };
const frames = new Map<number, FrameMesh>();

export const resetSquadFrames = () => frames.clear();

function makeFrame(): FrameMesh {
  const group = new THREE.Group();
  const frame = new THREE.Group();
  const fill = fading(COLOR.friendly, 0.18);
  const stroke = fading(COLOR.friendly);
  frame.add(new THREE.Mesh(fillGeometry, fill));
  for (const g of frameGeometries) frame.add(new THREE.Mesh(g, stroke));
  frame.position.set(px(18) + FW, px(22), 0);
  group.add(frame);
  layer.add(group);
  return { group, fill, stroke };
}

/** `scale` is the symbol unit in metres. */
export function drawSquadFrames(view: CommanderView, scale: number) {
  for (const q of view.squads) {
    const lead = view.friendlies.find((f) => f.id === q.leader);
    let f = frames.get(q.id);
    if (!f) frames.set(q.id, (f = makeFrame()));
    f.group.visible = !!lead;
    if (!lead) continue;
    const color = targeting.selected === q.id ? COLOR.amber : COLOR.friendly;
    f.fill.color.setHex(color);
    f.stroke.color.setHex(color);
    f.group.position.set(lead.x, lead.y, 1.1);
    f.group.scale.setScalar(scale);
  }
}
