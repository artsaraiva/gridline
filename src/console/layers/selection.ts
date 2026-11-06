// Selected Squad and Squad Leader markers (#71), the look-review candidate:
// - member: an amber ring around the chevron (13 px radius, 1.5 px stroke), on every present member of the selected
//   Squad, Wounded included. A ring is the one closed outline on the map, so it reads without colour;
// - leader: a short amber bar capping the ring on the north side (14 × 3 px), whenever the Squad has a leader.
// Markers sit at z 1.05: above the chevron (1, whose colour the #70 firing pulse changes) and under the Squad frame (1.1)
// and tracers. Screen-aligned, not rotated with the chevron. Which Soldiers carry them: summary.ts `selectionMarks`.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, layer } from '../renderer';
import { selectionMarks } from '../summary';
import { targeting } from '../targeting';
import { bar, fading, px } from './symbols';

const R = px(13);
const ringGeometry = new THREE.RingGeometry(R - px(0.75), R + px(0.75), 40);
const barGeometry = bar(-px(7), R + px(4), px(7), R + px(4), px(3));

const rings = new Map<number, THREE.Mesh>();
let leaderBar: THREE.Mesh | null = null;

export function resetSelection() {
  rings.clear();
  leaderBar = null;
}

function ringFor(id: number) {
  let m = rings.get(id);
  if (!m) {
    m = new THREE.Mesh(ringGeometry, fading(COLOR.amber));
    layer.add(m);
    rings.set(id, m);
  }
  return m;
}

/** `scale` is the symbol unit in metres. */
export function drawSelection(view: CommanderView, scale: number) {
  const { members, leader } = selectionMarks(view, targeting.selected);
  for (const m of rings.values()) m.visible = false;
  for (const id of members) {
    const f = view.friendlies.find((s) => s.id === id)!;
    const ring = ringFor(id);
    ring.visible = true;
    ring.position.set(f.x, f.y, 1.05);
    ring.scale.setScalar(scale);
  }
  if (!leaderBar) layer.add((leaderBar = new THREE.Mesh(barGeometry, fading(COLOR.amber))));
  const lead = leader === null ? undefined : view.friendlies.find((f) => f.id === leader);
  leaderBar.visible = !!lead;
  if (!lead) return;
  leaderBar.position.set(lead.x, lead.y, 1.05);
  leaderBar.scale.setScalar(scale);
}
