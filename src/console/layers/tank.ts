// Tanks on the map (#107): own tanks, enemy tanks in sight (the same sprite in its Faction's paint) and Wrecks; the baked hull
// at the nearest heading with the turret laid on its target over it, each with its ground shadow. Over each live tank BF4's
// tactical tank icon at constant screen size (hull outline, turret and gun turning with the sprite's), in its Side's colour or
// grey-white while nobody is aboard; and each main gun round in the air as a short bright streak. sprites/tank.ts says how.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, metresPerPx, pool } from '../renderer';
import { session } from '../session';
import { spriteMesh } from '../sprites/sheet';
import { roundStreak, TANK_SHEET, tankIcon, tankPose } from '../sprites/tank';
import { bar, fading, px, shade, streak } from './symbols';

const Z = { wreck: 0.44, shadow: 0.42, hull: 0.46, turret: 0.47, round: 0.6, icon: 0.93 };
const SHADOW_OPACITY = 0.5;
/** Icon size in chevrons. */
const ICON_SCALE = 1.7;
const ROUND_PX = 1.8;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6 };

/** A rounded rectangle `w` x `h` symbol units centred on (0, `cy`), corner radius `r`. */
function rounded(w: number, h: number, r: number, cy = 0) {
  const [hw, hh] = [w / 2, h / 2];
  const p = new THREE.Shape();
  p.moveTo(-hw + r, cy - hh);
  p.lineTo(hw - r, cy - hh);
  p.quadraticCurveTo(hw, cy - hh, hw, cy - hh + r);
  p.lineTo(hw, cy + hh - r);
  p.quadraticCurveTo(hw, cy + hh, hw - r, cy + hh);
  p.lineTo(-hw + r, cy + hh);
  p.quadraticCurveTo(-hw, cy + hh, -hw, cy + hh - r);
  p.lineTo(-hw, cy - hh + r);
  p.quadraticCurveTo(-hw, cy - hh, -hw + r, cy - hh);
  return p;
}

/** Merges geometries (non-indexed positions only). */
function merge(parts: THREE.BufferGeometry[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(parts.flatMap((p) => [...(p.toNonIndexed().getAttribute('position').array as Float32Array)]), 3));
  return g;
}

// BF4's tank icon, in chevrons, nose +y, grown by `g` for its dark halo: a bold hull outline over a faint hull fill, and over
// that the solid turret with its gun reaching well past the hull.
const HULL = { w: 0.94, h: 1.34, r: 0.2 };
const hullLine = (s: number, g = 0) => {
  const shape = rounded(HULL.w + s + g, HULL.h + s + g, HULL.r + (s + g) / 2);
  shape.holes.push(rounded(HULL.w - s - g, HULL.h - s - g, Math.max(0.02, HULL.r - (s + g) / 2)));
  return new THREE.ShapeGeometry(shape, 4);
};
const hullFill = new THREE.ShapeGeometry(rounded(HULL.w, HULL.h, HULL.r), 4);
const turret = (g = 0) => merge([new THREE.ShapeGeometry(rounded(0.56 + g, 0.62 + g, 0.16 + g / 2, -0.06), 4), bar(0, 0.12, 0, 1.08 + g / 2, px(3.2) + g)]);
const LINE = px(2.6);
const HALO = px(2.5);

const shadows = pool(() => spriteMesh(TANK_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const parts = pool(() => spriteMesh(TANK_SHEET));
const icons = pool(() => {
  const hull = new THREE.Mesh(hullLine(LINE), fading(COLOR.friendly));
  hull.add(new THREE.Mesh(hullFill, fading(COLOR.friendly, 0.28)).translateZ(-0.005));
  hull.add(new THREE.Mesh(hullLine(LINE, HALO), shade(0x000000, 0.55)).translateZ(-0.01));
  const top = new THREE.Mesh(turret(), fading(COLOR.friendly));
  top.add(new THREE.Mesh(turret(HALO), shade(0x000000, 0.6)).translateZ(-0.002));
  top.position.z = 0.01;
  return Object.assign(new THREE.Group().add(hull, top), { hull, turret: top, fill: hull.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicNodeMaterial> });
});
const rounds = pool(() => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), streak(0xffe6a0)));

/** `scale` is the chevron size in metres (constant on screen), for the icon. */
export function drawTanks(view: CommanderView, scale: number) {
  for (const v of view.vehicles ?? []) {
    const p = tankPose(v);
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
    const role = tankIcon(v, session.commanderSide);
    if (role) {
      const icon = icons.next();
      icon.position.set(p.x, p.y, Z.icon);
      icon.scale.setScalar(scale * ICON_SCALE);
      icon.hull.rotation.z = Math.atan2(v.fy, v.fx) - Math.PI / 2;
      icon.turret.rotation.z = Math.atan2(v.ty, v.tx) - Math.PI / 2;
      for (const part of [icon.hull, icon.turret, icon.fill]) part.material.color.setHex(ICON_COLOR[role]);
    }
    for (const r of v.rounds ?? []) {
      const s = roundStreak(r);
      const m = rounds.next();
      m.position.set(s.x, s.y, Z.round);
      m.rotation.z = s.angle;
      m.scale.set(Math.max(s.length, 0.01), ROUND_PX * metresPerPx.value, 1);
    }
  }
  shadows.end();
  parts.end();
  icons.end();
  rounds.end();
}
