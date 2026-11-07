// The Scan UAV circling its ring (#53): the baked aircraft at the nearest heading, its ground shadow, and a tactical
// UAV icon riding just outside the orbit at constant screen size. sprites/scan-uav.ts says where it is.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, pool } from '../renderer';
import { scanUav, UAV_SHADOW_FRAME, UAV_SHEET } from '../sprites/scan-uav';
import { spriteMesh } from '../sprites/sheet';
import { fading, shade } from './symbols';

// Tactical UAV symbol: a straight-winged airframe seen from above (wide wing bar, fuselage, tail bar), pointing +y.
const uavIconShape = new THREE.Shape(
  [
    [0, 0.5], [0.09, 0.36], [0.09, 0.16], [0.62, 0.16], [0.62, 0], [0.09, 0], [0.07, -0.32], [0.28, -0.34], [0.28, -0.48],
    [-0.28, -0.48], [-0.28, -0.34], [-0.07, -0.32], [-0.09, 0], [-0.62, 0], [-0.62, 0.16], [-0.09, 0.16], [-0.09, 0.36],
  ].map(([x, y]) => new THREE.Vector2(x, y)),
);
const uavIconGeometry = new THREE.ShapeGeometry(uavIconShape);
const uavHaloGeometry = uavIconGeometry.clone().scale(1.22, 1.3, 1).translate(0, 0, -0.02);

const uavs = pool(() => {
  const shadow = spriteMesh(UAV_SHEET, { frame: UAV_SHADOW_FRAME, shadow: true, opacity: 0.42 });
  const body = spriteMesh(UAV_SHEET);
  const icon = new THREE.Mesh(uavIconGeometry, fading(COLOR.friendly));
  icon.add(new THREE.Mesh(uavHaloGeometry, shade(0x000000, 0.75)));
  return Object.assign(new THREE.Group().add(shadow, body, icon), { shadow, body, icon });
});

/** `scale` is the chevron size in metres (constant on screen), used for the icon. */
export function drawScanUavs(view: CommanderView, scale: number, now: number) {
  for (const e of view.effects ?? []) {
    if (e.asset !== 'scan') continue;
    const u = scanUav(e, e.radius, now / 1000);
    const m = uavs.next();
    m.shadow.position.set(u.shadow.x, u.shadow.y, 0.42);
    m.shadow.rotation.z = u.shadow.rotation;
    m.shadow.scale.setScalar(u.size);
    m.body.position.set(u.x, u.y, 0.72);
    m.body.rotation.z = u.rotation;
    m.body.scale.setScalar(u.size);
    m.body.frame.value = u.frame;
    // Icon rides just outside the orbit, clear of the aircraft at close zoom and on it at overview.
    const off = Math.max(scale * 1.1, u.size * 0.75);
    m.icon.position.set(u.x + Math.sin(u.heading) * off, u.y - Math.cos(u.heading) * off, 0.92);
    m.icon.rotation.z = u.heading - Math.PI / 2;
    m.icon.scale.setScalar(scale * 1.1);
  }
  uavs.end();
}
