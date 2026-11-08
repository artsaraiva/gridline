// Jeeps on the map (#108): own jeeps, enemy jeeps in sight (the same sprite in its Faction's paint) and Wrecks; the baked body
// at the nearest heading over its ground shadow. Over each live jeep BF4's light-vehicle icon at constant screen size (a solid
// rounded block in the role colour with a lighter arch inside, turning with the sprite), coloured as the tank's (sprites/vehicle-icon.ts).
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, pool } from '../renderer';
import { session } from '../session';
import { targeting } from '../targeting';
import { spriteMesh } from '../sprites/sheet';
import { JEEP_SHEET, jeepPose } from '../sprites/jeep';
import { vehicleIcon } from '../sprites/vehicle-icon';
import { bar, fading, merge, px, shade } from './symbols';

const Z = { wreck: 0.44, shadow: 0.42, body: 0.46, icon: 0.93 };
const SHADOW_OPACITY = 0.5;
/** Icon size in chevrons: about a Soldier's, a little under the tank's. */
const ICON_SCALE = 1;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6, selected: COLOR.amber };

// BF4's icon, in chevrons, nose +y: a solid rounded block (`g` grows it for the dark halo), and inside it a lighter arch, open
// toward the back: the windscreen across and the two sides of the open cab.
function block(g = 0) {
  const [hw, hh, r] = [0.36 + g / 2, 0.44 + g / 2, 0.11 + g / 2];
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return new THREE.ShapeGeometry(s, 4);
}
const W = 0.1; // the arch's stroke
const arch = () => merge([bar(-0.18 - W / 2, 0.18, 0.18 + W / 2, 0.18, W), bar(-0.18, 0.18, -0.18, -0.24, W), bar(0.18, 0.18, 0.18, -0.24, W)]);
const HALO = px(2.5);
const LIGHT = new THREE.Color(0xffffff);

const shadows = pool(() => spriteMesh(JEEP_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const bodies = pool(() => spriteMesh(JEEP_SHEET));
const icons = pool(() => {
  const m = new THREE.Mesh(block(), fading(COLOR.friendly));
  m.add(new THREE.Mesh(block(HALO), shade(0x000000, 0.45)).translateZ(-0.01));
  const inner = new THREE.Mesh(arch(), fading(0xffffff));
  inner.position.z = 0.005;
  m.add(inner);
  return Object.assign(m, { inner });
});

/** `scale` is the chevron size in metres (constant on screen), for the icon. */
export function drawJeeps(view: CommanderView, scale: number) {
  const selected = view.friendlies.filter((f) => f.squad === targeting.selected).map((f) => f.id);
  for (const v of view.vehicles ?? []) {
    if (v.kind !== 'jeep') continue;
    const p = jeepPose(v);
    const s = shadows.next();
    s.position.set(p.x, p.y, Z.shadow);
    s.rotation.z = p.shadow.rotation;
    s.scale.setScalar(p.size);
    s.frame.value = p.shadow.frame;
    const b = bodies.next();
    b.position.set(p.x, p.y, v.wreck ? Z.wreck : Z.body);
    b.rotation.z = p.body.rotation;
    b.scale.setScalar(p.size);
    b.frame.value = p.body.frame;
    const role = vehicleIcon(v, session.commanderSide, selected);
    if (role) {
      const icon = icons.next();
      icon.position.set(p.x, p.y, Z.icon);
      icon.scale.setScalar(scale * ICON_SCALE);
      icon.rotation.z = Math.atan2(v.fy, v.fx) - Math.PI / 2;
      icon.material.color.setHex(ICON_COLOR[role]);
      icon.inner.material.color.setHex(ICON_COLOR[role]).lerp(LIGHT, 0.6);
    }
  }
  shadows.end();
  bodies.end();
  icons.end();
}
