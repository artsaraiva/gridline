// #110: lock-on missiles in flight (an AA's, or a jet's at the enemy jet): a bright head and a short smoke trail behind it,
// drawn aloft as the aircraft they chase. They ride on their launcher's VehicleView, so a missile shows where its launcher does.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { metresPerPx, pool } from '../renderer';
import { aloft } from '../sprites/missile';
import { fading, px, streak } from './symbols';

const TRAIL_M = 30;
const TRAIL_PX = 2;
const Z = { trail: 0.76, head: 0.77 }; // over the aircraft
const quad = new THREE.PlaneGeometry(1, 1);
const head = new THREE.CircleGeometry(px(2), 8);

const trails = pool(() => new THREE.Mesh(quad, streak()));
const heads = pool(() => new THREE.Mesh(head, fading(0xffe6a0)));

/** `scale` is the chevron size in metres (constant on screen), for the head. */
export function drawAirMissiles(view: CommanderView, scale: number) {
  for (const v of view.vehicles ?? [])
    for (const s of v.missiles ?? []) {
      const p = aloft(s);
      const t = trails.next();
      t.position.set(p.x - (s.fx * TRAIL_M) / 2, p.y - (s.fy * TRAIL_M) / 2, Z.trail);
      t.rotation.z = Math.atan2(s.fy, s.fx);
      t.scale.set(TRAIL_M, TRAIL_PX * metresPerPx.value, 1);
      const h = heads.next();
      h.position.set(p.x, p.y, Z.head);
      h.scale.setScalar(scale);
    }
  trails.end();
  heads.end();
}
