// Chevrons: one per Soldier (friendly blue, Contacts hostile red) on a dark halo, pointing +x before rotation,
// constant size on screen. They rest at the palette colour; the halo flashes white when their Soldier fires (#70, #90, pulse.ts).
// A Squad Leader's icon is a star instead of a chevron (#71, as BF4's Commander mode): it turns with the facing, and its
// forward point is notched to show which way. Every leader sits in a faint dashed corner bracket; the selected Squad's
// leader in a bright solid one, and the selected Squad's members are amber (#92, as BF4 Commander plus a colour).
import * as THREE from 'three/webgpu';
import type { CommanderView, FriendlyView, SideId, SoldierView } from '../../sim/types';
import { COLOR, layer } from '../renderer';
import { session } from '../session';
import { targeting } from '../targeting';
import { haloColor, pulseAt, pulseColor } from './pulse';
import { bar, fading, px, shade } from './symbols';

const chevronShape = new THREE.Shape([
  new THREE.Vector2(0.65, 0),
  new THREE.Vector2(-0.5, 0.425),
  new THREE.Vector2(-0.225, 0),
  new THREE.Vector2(-0.5, -0.425),
]);
const chevronGeometry = new THREE.ShapeGeometry(chevronShape);
const haloGeometry = chevronGeometry.clone().scale(1.3, 1.35, 1).translate(-0.02, 0, -0.05);

// Five-point star, one point on +x, that point cut by a notch so the star reads a direction.
const STAR_R = 0.68;
const NOTCH = Math.PI / 18; // half-angle of the cut at the forward point
const starShape = new THREE.Shape(
  Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5;
    const r = i % 2 ? STAR_R * 0.45 : STAR_R;
    if (i) return [new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)];
    return [new THREE.Vector2(Math.cos(-NOTCH) * r, Math.sin(-NOTCH) * r), new THREE.Vector2(r * 0.5, 0), new THREE.Vector2(Math.cos(NOTCH) * r, Math.sin(NOTCH) * r)];
  }).flat(),
);
const starGeometry = new THREE.ShapeGeometry(starShape);
const starHaloGeometry = starGeometry.clone().scale(1.25, 1.25, 1).translate(0, 0, -0.05);

// Corner brackets (#92): four L corners `BRACKET` units from the centre, arms `ARM` long; the dashed one cuts each arm in two.
export const BRACKET = 1.05; // grid.ts stops the crosshair at it
const ARM = 0.42;
const bracketGeometry = (dashed: boolean) => {
  const w = px(1.5);
  const pieces: [number, number][] = dashed ? [[0, 0.17], [0.26, ARM]] : [[0, ARM]];
  const g = new THREE.Group();
  for (const sx of [1, -1])
    for (const sy of [1, -1])
      for (const [a, b] of pieces) {
        g.add(new THREE.Mesh(bar(sx * BRACKET, sy * (BRACKET - a), sx * BRACKET, sy * (BRACKET - b), w)));
        g.add(new THREE.Mesh(bar(sx * (BRACKET - a), sy * BRACKET, sx * (BRACKET - b), sy * BRACKET, w)));
      }
  return g;
};
const BRACKET_DIM = fading(COLOR.bone, 0.4);
const BRACKET_BRIGHT = fading(COLOR.bone, 1);
const brackets = new Map<number, { group: THREE.Group; dashed: THREE.Group; solid: THREE.Group }>(); // Squad id -> its leader's bracket

const HALO = 0.75;
const chevrons = new Map<string, { mesh: THREE.Mesh; haloMesh: THREE.Mesh; halo: THREE.MeshBasicNodeMaterial }>();
const firedAt = new Map<string, number>(); // chevron key -> time of its Soldier's last shot (#70)
const keyOf = (kind: 'friendly' | 'hostile', id: number) => `${kind}${id}`;

export const resetChevrons = () => {
  chevrons.clear();
  brackets.clear();
  firedAt.clear();
};

/** Soldier `id` of `side` fired at `now`: its chevron pulses. Harmless for a Soldier with no chevron (an unseen enemy). */
export function pulse(id: number, side: SideId, now: number) {
  firedAt.set(keyOf(side === session.commanderSide ? 'friendly' : 'hostile', id), now);
}

function draw(list: (SoldierView | FriendlyView)[], kind: 'friendly' | 'hostile', seen: Set<string>, scale: number, now: number, leaders: Set<number>) {
  for (const c of list) {
    const key = keyOf(kind, c.id);
    let chevron = chevrons.get(key);
    if (!chevron) {
      const halo = shade(0x000000, HALO);
      const haloMesh = new THREE.Mesh(haloGeometry, halo);
      chevron = { mesh: new THREE.Mesh(chevronGeometry, fading(COLOR[kind])), haloMesh, halo };
      chevron.mesh.add(haloMesh);
      layer.add(chevron.mesh);
      chevrons.set(key, chevron);
    }
    const { mesh, haloMesh, halo } = chevron;
    const star = kind === 'friendly' && leaders.has(c.id);
    mesh.geometry = star ? starGeometry : chevronGeometry;
    haloMesh.geometry = star ? starHaloGeometry : haloGeometry;
    mesh.position.set(c.x, c.y, 1);
    mesh.rotation.z = Math.atan2(c.fy, c.fx);
    mesh.scale.setScalar(scale);
    const alpha = 'state' in c && c.state === 'wounded' ? 0.35 : 1;
    const material = mesh.material as THREE.MeshBasicNodeMaterial;
    material.opacity = alpha;
    const p = pulseAt(now - (firedAt.get(key) ?? -Infinity));
    const base = 'squad' in c && c.squad === targeting.selected ? COLOR.amber : COLOR[kind];
    material.color.setHex(pulseColor(base, p));
    halo.color.setHex(haloColor(p));
    halo.opacity = HALO * alpha;
    seen.add(key);
  }
}

/**
 * Friendlies and Contacts; chevrons of Soldiers missing from the view are hidden. `scale` is the chevron size in metres,
 * `now` the frame time for the firing pulse.
 */
export function drawChevrons(view: CommanderView, scale: number, now: number) {
  const seen = new Set<string>();
  const leaders = new Set(view.squads.map((q) => q.leader).filter((id): id is number => id != null));
  draw(view.friendlies.filter((f) => f.vehicle === undefined), 'friendly', seen, scale, now, leaders); // #107: aboard, the tank stands for them
  draw(view.contacts, 'hostile', seen, scale, now, new Set());
  for (const [key, { mesh }] of chevrons) mesh.visible = seen.has(key);
  drawBrackets(view, scale);
}

/** A bracket on each Squad Leader: dashed and faint, or solid and bright on the selected Squad's; none while a Squad has no leader. */
function drawBrackets(view: CommanderView, scale: number) {
  const shown = new Set<number>();
  for (const q of view.squads) {
    const lead = q.leader != null ? view.friendlies.find((f) => f.id === q.leader) : undefined;
    if (!lead) continue;
    let b = brackets.get(q.id);
    if (!b) {
      const dashed = bracketGeometry(true);
      const solid = bracketGeometry(false);
      const group = new THREE.Group();
      group.add(dashed, solid);
      layer.add(group);
      b = { group, dashed, solid };
      brackets.set(q.id, b);
    }
    const sel = targeting.selected === q.id;
    b.dashed.visible = !sel;
    b.solid.visible = sel;
    for (const piece of [...b.dashed.children, ...b.solid.children]) (piece as THREE.Mesh).material = sel ? BRACKET_BRIGHT : BRACKET_DIM;
    b.group.position.set(lead.x, lead.y, 1.1);
    b.group.scale.setScalar(scale);
    b.group.visible = true;
    shown.add(q.id);
  }
  for (const [id, { group }] of brackets) if (!shown.has(id)) group.visible = false;
}
