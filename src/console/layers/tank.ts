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
const ROUND_PX = 2;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6 };

/** A rounded-rectangle outline `w` x `h` symbol units centred on (0, `cy`), stroke `s`. */
function outline(w: number, h: number, r: number, s: number, cy = 0) {
  const rect = (hw: number, hh: number, rr: number) => {
    const p = new THREE.Path();
    p.moveTo(-hw + rr, cy - hh);
    p.lineTo(hw - rr, cy - hh);
    p.quadraticCurveTo(hw, cy - hh, hw, cy - hh + rr);
    p.lineTo(hw, cy + hh - rr);
    p.quadraticCurveTo(hw, cy + hh, hw - rr, cy + hh);
    p.lineTo(-hw + rr, cy + hh);
    p.quadraticCurveTo(-hw, cy + hh, -hw, cy + hh - rr);
    p.lineTo(-hw, cy - hh + rr);
    p.quadraticCurveTo(-hw, cy - hh, -hw + rr, cy - hh);
    return p;
  };
  const shape = new THREE.Shape(rect(w / 2 + s / 2, h / 2 + s / 2, r + s / 2).getPoints());
  shape.holes.push(rect(w / 2 - s / 2, h / 2 - s / 2, Math.max(0, r - s / 2)));
  return new THREE.ShapeGeometry(shape, 4);
}

// BF4's tank icon, in chevrons, nose +y: the hull's outline, and over it the turret's outline with the gun reaching past the hull.
const hullGeometry = (s: number) => outline(0.92, 1.36, 0.16, s);
function turretGeometry(s: number) {
  const pieces = [outline(0.5, 0.56, 0.12, s, -0.04), bar(0, 0.24, 0, 0.98, s)].map((p) => p.toNonIndexed());
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pieces.flatMap((p) => [...(p.getAttribute('position').array as Float32Array)]), 3));
  return merged;
}
const LINE = px(2);
const HALO = px(4.5);

const shadows = pool(() => spriteMesh(TANK_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const parts = pool(() => spriteMesh(TANK_SHEET));
const icons = pool(() => {
  const hull = new THREE.Mesh(hullGeometry(LINE), fading(COLOR.friendly));
  const turret = new THREE.Mesh(turretGeometry(LINE), fading(COLOR.friendly));
  hull.add(new THREE.Mesh(hullGeometry(HALO), shade(0x000000, 0.55)).translateZ(-0.01));
  turret.add(new THREE.Mesh(turretGeometry(HALO), shade(0x000000, 0.55)).translateZ(-0.01));
  return Object.assign(new THREE.Group().add(hull, turret), { hull, turret });
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
      for (const part of [icon.hull, icon.turret]) part.material.color.setHex(ICON_COLOR[role]);
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
