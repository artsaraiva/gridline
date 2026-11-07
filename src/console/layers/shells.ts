// The Barrage's shells in flight (#53, #61): the baked body and ground shadow at the nearest heading, the smoke trail
// behind each, and a tactical shell icon beside it at constant screen size. sprites/shell.ts says where everything is.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, pool } from '../renderer';
import { session } from '../session';
import { spriteMesh } from '../sprites/sheet';
import { barrageShells, SHELL_SHADOW_FRAME, SHELL_SHEET, shellTrail } from '../sprites/shell';
import { SMOKE_PUFF_SHEET } from '../sprites/smoke-puff';
import { fading, shade } from './symbols';

// Tactical shell symbol (pointed warhead + cylindrical casing + flared tail fins, pointing +y before rotation).
const shellIconShape = new THREE.Shape([
  new THREE.Vector2(0, 0.62),
  new THREE.Vector2(0.15, 0.34),
  new THREE.Vector2(0.18, 0.14),
  new THREE.Vector2(0.18, -0.26),
  new THREE.Vector2(0.32, -0.44),
  new THREE.Vector2(0.32, -0.56),
  new THREE.Vector2(0.12, -0.46),
  new THREE.Vector2(0, -0.56),
  new THREE.Vector2(-0.12, -0.46),
  new THREE.Vector2(-0.32, -0.56),
  new THREE.Vector2(-0.32, -0.44),
  new THREE.Vector2(-0.18, -0.26),
  new THREE.Vector2(-0.18, 0.14),
  new THREE.Vector2(-0.15, 0.34),
]);
const shellIconGeometry = new THREE.ShapeGeometry(shellIconShape);
const shellHaloGeometry = shellIconGeometry.clone().scale(1.32, 1.24, 1).translate(0, 0, -0.02);

const shells = pool(() => {
  const shadow = spriteMesh(SHELL_SHEET, { frame: SHELL_SHADOW_FRAME, shadow: true });
  const body = spriteMesh(SHELL_SHEET);
  const icon = new THREE.Mesh(shellIconGeometry, fading(COLOR.hostile));
  icon.add(new THREE.Mesh(shellHaloGeometry, shade(0x000000, 0.75)));
  return Object.assign(new THREE.Group().add(shadow, body, icon), { shadow, body, icon });
});
const puffs = pool(() => spriteMesh(SMOKE_PUFF_SHEET));

/** `scale` is the chevron size in metres (constant on screen), used for the icon. */
export function drawShells(view: CommanderView, scale: number) {
  const map = session.host?.map;
  for (const s of map ? barrageShells(view, map) : []) {
    for (const t of shellTrail(s.from, s.to, s.flight)) {
      const p = puffs.next();
      p.position.set(t.x, t.y, 0.6);
      p.scale.setScalar(t.size);
      p.material.opacity = t.opacity;
      p.frame.value = t.frame;
    }
    const m = shells.next();
    m.shadow.position.set(s.shadow.x, s.shadow.y, 0.42);
    m.shadow.rotation.z = s.rotation;
    m.shadow.scale.setScalar(s.shadow.size);
    m.shadow.material.opacity = s.shadow.opacity;
    m.body.position.set(s.x, s.y, 0.72);
    m.body.rotation.z = s.bodyRotation;
    m.body.scale.setScalar(s.size);
    m.body.frame.value = s.frame;
    const nx = -Math.sin(s.heading);
    const ny = Math.cos(s.heading);
    m.icon.position.set(s.x + nx * scale * 0.75, s.y + ny * scale * 0.75, 0.92);
    m.icon.rotation.z = s.rotation;
    m.icon.scale.setScalar(scale * 0.85);
  }
  puffs.end();
  shells.end();
}
