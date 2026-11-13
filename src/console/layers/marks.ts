// Marks (#136): the Commander's intel markers. A filled diamond in the Side's colour with a "?" (filled, as every map icon),
// fading with its life, and a faint ring at `threatenedM`: an own Capture Point inside it counts as threatened. In Mark mode
// a ghost of it follows the pointer.
import * as THREE from 'three/webgpu';
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView, Vec2 } from '../../sim/types';
import { COLOR, pool } from '../renderer';
import { targeting } from '../targeting';
import { css, dashedRing, fading, frameFill, label, px, shade } from './symbols';

const HALF = px(10);
const FAINTEST = 0.35; // a Mark about to go is still readable
const RING = 0.3;
const Z = 0.7; // over the Order lines, under the chevrons

type Icon = THREE.Group & { userData: { fill: THREE.MeshBasicNodeMaterial; glyph: THREE.Material } };
const icons = pool(() => {
  const group = new THREE.Group() as Icon;
  const halo = new THREE.Mesh(frameFill('hostile', HALF + px(2)), shade(0x000000, 0.6));
  const fill = new THREE.Mesh(frameFill('hostile', HALF), fading(COLOR.friendly));
  const glyph = label('?', css(COLOR.ink), { size: 15 });
  fill.position.z = 0.01;
  glyph.position.z = 0.02;
  group.add(halo, fill, glyph);
  group.userData = { fill: fill.material, glyph: glyph.material };
  return group;
});
const alphaOf = new WeakMap<THREE.Object3D, { value: number }>(); // each ring's opacity uniform
const rings = pool(() => {
  const r = dashedRing(DEFAULT_TUNE.threatenedM, COLOR.friendly, { width: 1 });
  alphaOf.set(r.mesh, r.alpha);
  return r.mesh;
});

function draw(at: Vec2, opacity: number, scale: number) {
  const icon = icons.next();
  icon.position.set(at.x, at.y, Z);
  icon.scale.setScalar(scale);
  icon.userData.fill.opacity = opacity;
  icon.userData.glyph.opacity = opacity;
  const ring = rings.next();
  ring.position.set(at.x, at.y, Z - 0.05);
  alphaOf.get(ring)!.value = RING * opacity;
}

/** `scale` is the symbol unit in metres. */
export function drawMarks(view: CommanderView, scale: number) {
  for (const k of view.marks ?? []) draw(k, FAINTEST + (1 - FAINTEST) * k.fade, scale);
  if (targeting.marking && targeting.pointer) draw(targeting.pointer, 0.6, scale);
  icons.end();
  rings.end();
}
