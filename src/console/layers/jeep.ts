// Jeeps on the map (#108): own jeeps, enemy jeeps in sight (the same sprite in its Faction's paint) and Wrecks; the baked body
// at the nearest heading over its ground shadow. Over each live jeep a light-vehicle tactical icon at constant screen size (a
// short open frame with its windscreen bar, turning with the sprite), coloured as the tank's (sprites/vehicle-icon.ts).
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
/** Icon size in chevrons: smaller than the tank's. */
const ICON_SCALE = 0.95;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6, selected: COLOR.amber };

// The icon, in chevrons, nose +y: a narrow frame, its front bar the windscreen across, the bonnet a short stub ahead of it.
const W = 0.13; // stroke
const frame = (g = 0) =>
  merge([
    bar(-0.22, -0.36, -0.22, 0.2 + W / 2, W + g), // sides
    bar(0.22, -0.36, 0.22, 0.2 + W / 2, W + g),
    bar(-0.22 - W / 2, -0.36, 0.22 + W / 2, -0.36, W + g), // back
    bar(-0.22 - W / 2, 0.2, 0.22 + W / 2, 0.2, W + g), // windscreen
    bar(0, 0.2, 0, 0.42, 0.26 + g), // bonnet
  ]);
const HALO = px(2.5);

const shadows = pool(() => spriteMesh(JEEP_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const bodies = pool(() => spriteMesh(JEEP_SHEET));
const icons = pool(() => {
  const m = new THREE.Mesh(frame(), fading(COLOR.friendly));
  m.add(new THREE.Mesh(frame(HALO), shade(0x000000, 0.45)).translateZ(-0.01));
  return m;
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
    }
  }
  shadows.end();
  bodies.end();
  icons.end();
}
