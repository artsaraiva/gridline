// AAs on the map (#110): own ones, enemy ones in sight (the same sprite in its Faction's paint) and Wrecks; the baked hull at
// the nearest heading with the turret laid on its target over it, each with its ground shadow, as the tank's. Over each live
// one its tactical icon at constant screen size (the tank's hull frame under a square turret with a twin cannon, turning with
// the sprite's), coloured as the tank's (sprites/vehicle-icon.ts). Its fire is the tracer stream of layers/tracers.ts.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, pool } from '../renderer';
import { session } from '../session';
import { targeting } from '../targeting';
import { aaPose, AA_SHEET } from '../sprites/aa';
import { spriteMesh } from '../sprites/sheet';
import { iconDim, vehicleIcon } from '../sprites/vehicle-icon';
import { bar, fading, merge, px, shade } from './symbols';

const Z = { wreck: 0.44, shadow: 0.42, hull: 0.46, turret: 0.47, icon: 0.93 };
const SHADOW_OPACITY = 0.5;
const ICON_SCALE = 1.15;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6, selected: COLOR.amber };

// The icon, in chevrons, nose +y: the tank's open-fronted hull frame, and over it a square turret with two barrels; `g` grows
// a piece for its dark halo.
const W = 0.15;
const hull = (g = 0) =>
  merge([
    bar(-0.31, -0.4, -0.31, 0.34 + W / 2, W + g),
    bar(0.31, -0.4, 0.31, 0.34 + W / 2, W + g),
    bar(-0.4, -0.42, 0.4, -0.42, W + 0.02 + g),
    bar(-0.31 - W / 2, 0.34, -0.15, 0.34, W + g),
    bar(0.15, 0.34, 0.31 + W / 2, 0.34, W + g),
  ]);
const turret = (g = 0) => merge([bar(0, -0.26 - g / 2, 0, 0.06 + g / 2, 0.32 + g), bar(-0.1, 0, -0.1, 0.6 + g / 2, 0.07 + g), bar(0.1, 0, 0.1, 0.6 + g / 2, 0.07 + g)]);
const HALO = px(2.5);

const shadows = pool(() => spriteMesh(AA_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const parts = pool(() => spriteMesh(AA_SHEET));
const icons = pool(() => {
  const frame = new THREE.Mesh(hull(), fading(COLOR.friendly));
  frame.add(new THREE.Mesh(hull(HALO), shade(0x000000, 0.45)).translateZ(-0.01));
  const top = new THREE.Mesh(turret(), fading(COLOR.friendly));
  top.add(new THREE.Mesh(turret(HALO), shade(0x000000, 0.45)).translateZ(-0.005));
  top.position.z = 0.01;
  return Object.assign(new THREE.Group().add(frame, top), { hull: frame, turret: top });
});

/** `scale` is the chevron size in metres (constant on screen), for the icon. */
export function drawAas(view: CommanderView, scale: number) {
  const selected = view.friendlies.filter((f) => f.squad === targeting.selected).map((f) => f.id);
  for (const v of view.vehicles ?? []) {
    if (v.kind !== 'aa') continue;
    const p = aaPose(v);
    for (const s of [p.shadow.hull, p.shadow.turret]) {
      const m = shadows.next();
      m.position.set(p.x, p.y, Z.shadow);
      m.rotation.z = s.rotation;
      m.scale.setScalar(p.size);
      m.frame.value = s.frame;
    }
    [p.hull, p.turret].forEach((s, i) => {
      const m = parts.next();
      m.position.set(p.x, p.y, v.wreck ? Z.wreck + i * 0.005 : i ? Z.turret : Z.hull);
      m.rotation.z = s.rotation;
      m.scale.setScalar(p.size);
      m.frame.value = s.frame;
    });
    const role = vehicleIcon(v, session.commanderSide, selected);
    if (role) {
      const icon = icons.next();
      icon.position.set(p.x, p.y, Z.icon);
      icon.scale.setScalar(scale * ICON_SCALE);
      icon.hull.rotation.z = Math.atan2(v.fy, v.fx) - Math.PI / 2;
      icon.turret.rotation.z = Math.atan2(v.ty, v.tx) - Math.PI / 2;
      for (const part of [icon.hull, icon.turret]) part.material.color.setHex(ICON_COLOR[role]).multiplyScalar(iconDim(v)); // #143: dimmed while an EMP holds it
    }
  }
  shadows.end();
  parts.end();
  icons.end();
}
