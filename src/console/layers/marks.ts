// Marks (#136): the spots the Commander flagged. A filled diamond in the Side's colour with a "?" (filled, as every map icon),
// fading with its life, and a faint ring at `threatenedM`: an own Capture Point inside it counts as threatened. In Mark mode
// a ghost of it follows the pointer. A Mark placed or renewed pings: the diamond pops and a ring runs out from it to the
// `threatenedM` ring and fades. That is the Mark's own cue; a confirmed Asset throws a static burst on the feed instead (post.ts).
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
const PING_MS = 700;
const POP = 0.8; // the diamond starts this much larger and settles

type Icon = THREE.Group & { userData: { fill: THREE.MeshBasicNodeMaterial; glyph: THREE.Material } };
const icons = pool(() => {
  const group = new THREE.Group() as Icon;
  const halo = new THREE.Mesh(frameFill('hostile', HALF + px(2)), shade(0x000000, 0.6)); // 'hostile' is the diamond frame: the shape of a suspected enemy, in the Side's own colour
  const fill = new THREE.Mesh(frameFill('hostile', HALF), fading(COLOR.friendly));
  const glyph = label('?', css(COLOR.ink), { size: 15 });
  fill.position.z = 0.01;
  glyph.position.z = 0.02;
  group.add(halo, fill, glyph);
  group.userData = { fill: fill.material, glyph: glyph.material };
  return group;
});
type Ring = ReturnType<typeof dashedRing>;
const uniformsOf = new WeakMap<THREE.Object3D, Ring>(); // each pooled ring's radius and opacity uniforms
const ringPool = (o: { dash?: number; gap?: number; width: number }) =>
  pool(() => {
    const r = dashedRing(DEFAULT_TUNE.threatenedM, COLOR.friendly, o);
    uniformsOf.set(r.mesh, r);
    return r.mesh;
  });
const rings = ringPool({ width: 1 });
const pings = ringPool({ dash: 1, gap: 0, width: 2 }); // a solid line

function ringAt(from: ReturnType<typeof ringPool>, at: Vec2, radius: number, opacity: number) {
  const mesh = from.next();
  mesh.position.set(at.x, at.y, Z - 0.05);
  const r = uniformsOf.get(mesh)!;
  r.r.value = radius;
  r.alpha.value = opacity;
}

/** `pop` runs from 1 (just placed or renewed) to 0. */
function draw(at: Vec2, opacity: number, scale: number, pop = 0) {
  const icon = icons.next();
  icon.position.set(at.x, at.y, Z);
  icon.scale.setScalar(scale * (1 + POP * pop * pop));
  icon.userData.fill.opacity = opacity;
  icon.userData.glyph.opacity = opacity;
  ringAt(rings, at, DEFAULT_TUNE.threatenedM, RING * opacity);
}

const seen = new Map<number, { fade: number; pinged: number }>(); // per Mark id: its fade last frame, and when it last pinged

/** `scale` is the symbol unit in metres. */
export function drawMarks(view: CommanderView, scale: number, now: number) {
  const list = view.marks ?? [];
  for (const id of seen.keys()) if (!list.some((k) => k.id === id)) seen.delete(id);
  for (const k of list) {
    const was = seen.get(k.id);
    const pinged = !was || k.fade > was.fade + 0.01 ? now : was.pinged; // new, or its life went back up: renewed
    seen.set(k.id, { fade: k.fade, pinged });
    const left = Math.max(0, 1 - (now - pinged) / PING_MS);
    draw(k, FAINTEST + (1 - FAINTEST) * k.fade, scale, left);
    if (left > 0) ringAt(pings, k, DEFAULT_TUNE.threatenedM * (1 - left * left), left); // eases out to the ring, fading as it goes
  }
  if (targeting.marking && targeting.pointer) draw(targeting.pointer, 0.6, scale);
  icons.end();
  rings.end();
  pings.end();
}
