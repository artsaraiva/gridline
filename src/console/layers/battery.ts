// The artillery batteries on the map: each HQ's row of four guns, and each shot as its Side's shells leave: the next gun in
// turn fires its muzzle blast (layers/muzzle.ts) and throws its barrel back. A shell new to the view, early in its flight, is
// a shot (a Barrage's, a Creeping Barrage's, a Smoke Screen's). sprites/battery.ts says where the guns stand.
import * as THREE from 'three/webgpu';
import type { CommanderView, SideId } from '../../sim/types';
import { pool } from '../renderer';
import { session } from '../session';
import { BATTERY_GUNS, batteryOf, GUN, recoil } from '../sprites/battery';
import { addMuzzle } from './muzzle';
import { shade, soft } from './symbols';

const quad = new THREE.PlaneGeometry(1, 1);
const pits = pool(() => new THREE.Mesh(quad, soft(0x060504, { dark: true })));
const barrels = pool(() => new THREE.Mesh(quad, shade(0x2c302e, 1)));
// On the ground, under the vehicles.
const Z = { pit: 0.35, barrel: 0.4 };
/** A shell is a fresh shot while it is this early in its flight. */
const FRESH = 0.15;

/** Each gun's last shot, by Side: when (ms) and the bearing it fired on; the shells seen in the air last frame; and how many shots each battery has fired. */
const last: Record<SideId, ({ at: number; heading: number } | undefined)[]> = { nato: [], pact: [] };
let seen = new Set<string>();
const fired: Record<SideId, number> = { nato: 0, pact: 0 };

export const resetBattery = () => {
  last.nato = [];
  last.pact = [];
  seen = new Set();
  fired.nato = fired.pact = 0;
};

export function drawBatteries(view: CommanderView, now: number) {
  const map = session.host?.map;
  if (map) {
    const batteries = { nato: batteryOf(map, 'nato'), pact: batteryOf(map, 'pact') };
    const next = new Set<string>();
    for (const e of view.effects ?? []) {
      if (e.asset !== 'barrage' && e.asset !== 'creep' && e.asset !== 'smoke') continue;
      const side = 'side' in e ? e.side : view.side; // the Barrage's view names no Side: only its caller's view has it
      for (const s of e.shells) {
        const key = `${side}:${s.x}:${s.y}`;
        next.add(key);
        if (seen.has(key) || s.flight > FRESH) continue;
        const gun = fired[side]++ % BATTERY_GUNS;
        const from = batteries[side].guns[gun]!;
        const heading = Math.atan2(s.y - from.y, s.x - from.x);
        last[side][gun] = { at: now, heading };
        addMuzzle({ x: from.x + Math.cos(heading) * GUN.barrel, y: from.y + Math.sin(heading) * GUN.barrel, heading, at: now, power: 1 });
      }
    }
    seen = next;
    for (const side of ['nato', 'pact'] as const) {
      const b = batteries[side];
      b.guns.forEach((g, i) => {
        const shot = last[side][i];
        const heading = shot?.heading ?? Math.atan2(b.fy, b.fx);
        const back = shot ? recoil(now - shot.at) : 0;
        const pit = pits.next();
        pit.position.set(g.x, g.y, Z.pit);
        pit.scale.setScalar(GUN.pit);
        pit.material.opacity = 0.6;
        const [cx, cy] = [Math.cos(heading), Math.sin(heading)];
        // the barrel from its breech to its muzzle, and the breech block behind it
        for (const [from, to, width] of [[-GUN.breech, GUN.barrel, GUN.width], [-GUN.breech, 0, GUN.width * 2.2]] as const) {
          const m = barrels.next();
          const mid = (from + to) / 2 - back;
          m.position.set(g.x + cx * mid, g.y + cy * mid, Z.barrel);
          m.rotation.z = heading;
          m.scale.set(to - from, width, 1);
        }
      });
    }
  }
  for (const p of [pits, barrels]) p.end();
}
