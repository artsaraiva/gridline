// The Supply Drop crate (#53): the baked crate under its canopy with its ground shadow while falling, then the landed
// crate, and a tactical canopy-over-crate icon beside it at constant screen size. sprites/supply-drop.ts says where it is.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, pool } from '../renderer';
import { spriteMesh } from '../sprites/sheet';
import { SUPPLY_SHADOW_FRAME, SUPPLY_SHEET, supplyDrop } from '../sprites/supply-drop';
import { fading, shade } from './symbols';

// Tactical Supply Drop symbol: a canopy dome on two risers over a square crate.
const dome = Array.from({ length: 13 }, (_, i) => new THREE.Vector2(-0.5 * Math.cos((Math.PI * i) / 12), 0.2 + 0.4 * Math.sin((Math.PI * i) / 12)));
const riser = (sx: number) => new THREE.Shape([new THREE.Vector2(sx * 0.5, 0.2), new THREE.Vector2(sx * 0.4, 0.2), new THREE.Vector2(sx * 0.1, -0.16), new THREE.Vector2(sx * 0.2, -0.16)]);
const canopyIconGeometry = new THREE.ShapeGeometry([new THREE.Shape([...dome, new THREE.Vector2(0.25, 0.14), new THREE.Vector2(0, 0.2), new THREE.Vector2(-0.25, 0.14)]), riser(1), riser(-1)]);
const crateIconGeometry = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.24, -0.16), new THREE.Vector2(0.24, -0.16), new THREE.Vector2(0.24, -0.62), new THREE.Vector2(-0.24, -0.62)]));
/** A black halo behind an icon part, grown about the part's own centre. */
function halo(g: THREE.BufferGeometry, k: number) {
  const h = g.clone();
  h.computeBoundingBox();
  const c = h.boundingBox!.getCenter(new THREE.Vector3());
  return new THREE.Mesh(h.translate(-c.x, -c.y, 0).scale(k, k, 1).translate(c.x, c.y, -0.02), shade(0x000000, 0.75));
}

const drops = pool(() => {
  const shadow = spriteMesh(SUPPLY_SHEET, { frame: SUPPLY_SHADOW_FRAME, shadow: true });
  const body = spriteMesh(SUPPLY_SHEET);
  const canopy = new THREE.Mesh(canopyIconGeometry, fading(COLOR.friendly));
  canopy.add(halo(canopyIconGeometry, 1.3));
  const crate = new THREE.Mesh(crateIconGeometry, fading(COLOR.friendly));
  crate.add(halo(crateIconGeometry, 1.45));
  const icon = new THREE.Group().add(canopy, crate);
  return Object.assign(new THREE.Group().add(shadow, body, icon), { shadow, body, icon });
});

/** `scale` is the chevron size in metres (constant on screen), used for the icon. */
export function drawSupplyDrops(view: CommanderView, scale: number) {
  for (const e of view.effects ?? []) {
    if (e.asset !== 'supply' || e.landsIn === undefined || !e.fall) continue; // #142: the beacon falls too, in layers/beacon.ts
    const d = supplyDrop({ x: e.x, y: e.y, landsIn: e.landsIn, fall: e.fall });
    const m = drops.next();
    m.shadow.visible = !d.landed;
    m.shadow.position.set(d.shadow.x, d.shadow.y, 0.43);
    m.shadow.scale.setScalar(d.shadow.size);
    m.shadow.material.opacity = d.shadow.opacity;
    m.body.position.set(d.x, d.y, d.landed ? 0.45 : 0.75);
    m.body.scale.setScalar(d.size);
    m.body.frame.value = d.frame;
    // Constant screen size, just west of the crate so it never sits on the canopy (north-east of the crate).
    m.icon.position.set(d.crate.x - d.size * 0.12 - scale * 1.2, d.crate.y, 0.92);
    m.icon.scale.setScalar(scale * 1.3);
  }
  drops.end();
}
