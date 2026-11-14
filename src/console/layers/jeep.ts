// Jeeps on the map (#108): own jeeps, enemy jeeps in sight (the same sprite in its Faction's paint) and Wrecks; the baked body
// at the nearest heading over its ground shadow. Over each live jeep BF4's light-vehicle icon at constant screen size (a solid
// upright block in the role colour with its tyres showing and the dark top gunner on it, turning with the sprite and the MG),
// coloured as the tank's (sprites/vehicle-icon.ts).
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, pool } from '../renderer';
import { session } from '../session';
import { targeting } from '../targeting';
import { spriteMesh } from '../sprites/sheet';
import { JEEP_SHEET, jeepPose } from '../sprites/jeep';
import { iconDim, vehicleIcon } from '../sprites/vehicle-icon';
import { bar, merge, px, shade } from './symbols';

const Z = { wreck: 0.44, shadow: 0.42, body: 0.46, icon: 0.93 };
const SHADOW_OPACITY = 0.5;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6, selected: COLOR.amber };

// BF4's light-vehicle icon, in chevrons, nose +y, about 9 x 14 px: a solid upright block in the role colour, its four tyres
// standing off its sides with a dark gap between, and on it the top gunner (a touch left of centre) as a dark ring with its gun
// forward, turning with the MG. `g` grows it for the dark halo, which shows through the gaps. The block does not glow, so the
// bloom never fills the dark gunner or the gaps in.
const [HW, HH, R] = [0.32, 0.51, 0.07];
const [GAP, TYRE, TYRE_Y] = [px(1), px(1.5), [0.27, 0.47]]; // gap to the side, tyre thickness, tyre span from the middle
function block(g = 0) {
  const [hw, hh, r] = [HW + g / 2, HH + g / 2, R + g / 2];
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
  const x = HW + GAP + TYRE / 2;
  const [y0, y1] = [TYRE_Y[0]! - g / 2, TYRE_Y[1]! + g / 2];
  const tyres = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => bar(sx * x, sy * y0, sx * x, sy * y1, TYRE + g)));
  return merge([new THREE.ShapeGeometry(s, 4), ...tyres]);
}
const [RING, STROKE, GUNNER_X, GUNNER_Y] = [px(2.9), px(1.5), -0.06, -0.07]; // ring outer radius, stroke, centre on the block
const gunner = () =>
  merge([new THREE.RingGeometry(RING - STROKE, RING, 24), bar(0, RING - STROKE / 2, 0, HH - 0.1 - GUNNER_Y, STROKE)]);
const HALO = px(2.5);

const shadows = pool(() => spriteMesh(JEEP_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const bodies = pool(() => spriteMesh(JEEP_SHEET));
const icons = pool(() => {
  const m = new THREE.Mesh(block(), shade(COLOR.friendly, 1));
  m.add(new THREE.Mesh(block(HALO), shade(0x000000, 0.45)).translateZ(-0.01));
  const top = new THREE.Mesh(gunner(), shade(0x000000, 0.85));
  top.position.set(GUNNER_X, GUNNER_Y, 0.005);
  m.add(top);
  return Object.assign(m, { top });
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
      icon.scale.setScalar(scale);
      icon.rotation.z = Math.atan2(v.fy, v.fx) - Math.PI / 2;
      icon.top.rotation.z = Math.atan2(v.ty, v.tx) - Math.atan2(v.fy, v.fx);
      icon.material.color.setHex(ICON_COLOR[role]).multiplyScalar(iconDim(v)); // #143: dimmed while an EMP holds it
    }
  }
  shadows.end();
  bodies.end();
  icons.end();
}
