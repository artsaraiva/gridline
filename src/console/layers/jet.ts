// Jets on the map (#110): own ones, the enemy's while over the Play Area (the sky rule; the same sprite in its Faction's paint)
// and Wrecks. In flight the baked body at the nearest heading, lifted north-east of its ground shadow to the Cruise Missile's
// altitude, its contrail behind it, and its tactical icon over it at constant screen size (a filled swept-wing jet in the role
// colour, sprites/vehicle-icon.ts); off screen the icon is glued to the screen edge toward it with an arrow out to it, as the
// missile's (#99). At the base an own jet shows as that icon alone on its slot in the HQ park. sprites/jet.ts says where.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { edgeClamp } from '../edge-clamp';
import { COLOR, metresPerPx, pool, toScreen, toWorld } from '../renderer';
import { session } from '../session';
import { targeting } from '../targeting';
import { JET_SHEET, jetPose } from '../sprites/jet';
import { spriteMesh } from '../sprites/sheet';
import { vehicleIcon } from '../sprites/vehicle-icon';
import { bar, fading, merge, px, shade, streak } from './symbols';

// In the air over everything on the ground and the missile's body; on the ground as a Wreck
const Z = { wreck: 0.44, shadow: 0.43, trail: 0.68, body: 0.74, icon: 0.95 };
const SHADOW_OPACITY = 0.42;
const TRAIL_PX = 2;
const TRAIL_OPACITY = 0.45;
const ICON_SCALE = 1.1;
const ARROW_SCALE = 1.6;
/** The edge-clamped icon's centre keeps this far inside the screen, as the missile's. */
const EDGE_MARGIN_PX = 56;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6, selected: COLOR.amber };

// The icon, in chevrons, nose +y: a pointed fuselage, swept wings and tailplanes; the right half, mirrored. `g` grows it for its halo.
const HALF: [number, number][] = [[0, 0.66], [0.08, 0.42], [0.09, 0.14], [0.56, -0.22], [0.56, -0.32], [0.09, -0.2], [0.09, -0.42], [0.26, -0.56], [0.26, -0.64], [0.06, -0.6], [0, -0.64]];
function shape(g = 0) {
  const pts = [...HALF, ...HALF.slice(1, -1).reverse().map(([x, y]): [number, number] => [-x, y])];
  const c = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  return new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * (1 + g * 2), c + (y - c) * (1 + g * 1.5)))));
}
const HALO = px(2.5);
const arrowGeometry = merge([bar(-0.14, 0.26, 0.1, 0, px(3 / ARROW_SCALE)), bar(0.1, 0, -0.14, -0.26, px(3 / ARROW_SCALE))]);
const quad = new THREE.PlaneGeometry(1, 1);

const shadows = pool(() => spriteMesh(JET_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const bodies = pool(() => spriteMesh(JET_SHEET));
const trails = pool(() => {
  const m = new THREE.Mesh(quad, streak());
  (m.material as THREE.MeshBasicNodeMaterial).opacity = TRAIL_OPACITY;
  return m;
});
const icons = pool(() => {
  const m = new THREE.Mesh(shape(), fading(COLOR.friendly));
  m.add(new THREE.Mesh(shape(HALO), shade(0x000000, 0.45)).translateZ(-0.01));
  return m;
});
const arrows = pool(() => new THREE.Mesh(arrowGeometry, fading(COLOR.friendly)));

/** `scale` is the chevron size in metres (constant on screen), for the icon. */
export function drawJets(view: CommanderView, scale: number) {
  const selected = view.friendlies.filter((f) => f.squad === targeting.selected).map((f) => f.id);
  const box = { x0: EDGE_MARGIN_PX, y0: EDGE_MARGIN_PX, x1: innerWidth - EDGE_MARGIN_PX, y1: innerHeight - EDGE_MARGIN_PX };
  for (const v of view.vehicles ?? []) {
    if (v.kind !== 'jet') continue;
    const p = jetPose(v);
    if (v.airborne || v.wreck) {
      const s = shadows.next();
      s.position.set(p.shadow.x, p.shadow.y, Z.shadow);
      s.rotation.z = p.shadow.rotation;
      s.scale.setScalar(p.size);
      s.frame.value = p.shadow.frame;
      const b = bodies.next();
      b.position.set(p.x, p.y, v.wreck ? Z.wreck : Z.body);
      b.rotation.z = p.body.rotation;
      b.scale.setScalar(p.size);
      b.frame.value = p.body.frame;
    }
    if (p.contrail) {
      const t = trails.next();
      t.position.set(p.contrail.x, p.contrail.y, Z.trail);
      t.rotation.z = p.contrail.angle;
      t.scale.set(p.contrail.length, TRAIL_PX * metresPerPx.value, 1);
    }
    const role = vehicleIcon(v, session.commanderSide, selected);
    if (!role) continue;
    const at = v.airborne ? edgeClamp(toScreen(p), { x: innerWidth / 2, y: innerHeight / 2 }, box) : { ...p, clamped: false };
    const w = at.clamped ? toWorld(at.x, at.y) : p;
    const icon = icons.next();
    icon.position.set(w.x, w.y, Z.icon);
    icon.rotation.z = p.heading - Math.PI / 2;
    icon.scale.setScalar(scale * ICON_SCALE);
    icon.material.color.setHex(ICON_COLOR[role]);
    if (at.clamped) {
      const out = Math.atan2(p.y - w.y, p.x - w.x);
      const off = scale * ICON_SCALE * 1.1;
      const arrow = arrows.next();
      arrow.position.set(w.x + Math.cos(out) * off, w.y + Math.sin(out) * off, Z.icon);
      arrow.rotation.z = out;
      arrow.scale.setScalar(scale * ARROW_SCALE);
      arrow.material.color.setHex(ICON_COLOR[role]);
    }
  }
  for (const q of [shadows, bodies, trails, icons, arrows]) q.end();
}
