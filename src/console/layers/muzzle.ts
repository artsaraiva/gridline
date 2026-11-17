// Heavy guns' muzzle blasts on the map: each layer that fires one (the batteries, the tanks, the lock-on missiles' launchers)
// hands it over with `addMuzzle`, and it is drawn here until it is over. sprites/muzzle.ts says how a blast looks.
import * as THREE from 'three/webgpu';
import { metresPerPx, pool } from '../renderer';
import type { ImpactGlow } from '../sprites/impact';
import { MUZZLE_BLAST_MS, type MuzzleBlast, muzzleLook } from '../sprites/muzzle';
import { spriteMesh } from '../sprites/sheet';
import { SMOKE_PUFF_SHEET } from '../sprites/smoke-puff';
import { soft, softRing, streak } from './symbols';

const quad = new THREE.PlaneGeometry(1, 1);
const glows = {
  flash: pool(() => new THREE.Mesh(quad, soft(0xfffcf0))),
  light: pool(() => new THREE.Mesh(quad, soft(0xffce8c))),
  ring: pool(() => new THREE.Mesh(quad, softRing(0xbeb4a0, 0.06, false))),
};
const flames = pool(() => new THREE.Mesh(quad, streak(0xffe6aa)));
const smoke = pool(() => spriteMesh(SMOKE_PUFF_SHEET));
// The dust ring on the ground under the vehicles; the smoke, light and flame over them.
const Z = { ring: 0.41, smoke: 0.62, light: 0.67, flash: 0.68, flame: 0.69 };
const FLAME_PX = 3;

let blasts: MuzzleBlast[] = [];

export const resetMuzzles = () => {
  blasts = [];
};

export const addMuzzle = (b: MuzzleBlast) => void blasts.push(b);

function glow(kind: keyof typeof glows, g: ImpactGlow | null) {
  if (!g || g.opacity <= 0) return;
  const m = glows[kind].next();
  m.position.set(g.x, g.y, Z[kind]);
  m.scale.setScalar(g.size);
  (m.material as THREE.MeshBasicNodeMaterial).opacity = g.opacity;
}

export function drawMuzzles(now: number) {
  blasts = blasts.filter((b) => now - b.at < MUZZLE_BLAST_MS);
  for (const b of blasts) {
    const look = muzzleLook(b, now);
    glow('ring', look.ring);
    glow('light', look.light);
    glow('flash', look.flash);
    for (const f of look.flames) {
      const m = flames.next();
      m.position.set((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, Z.flame);
      m.rotation.z = Math.atan2(f.y1 - f.y0, f.x1 - f.x0);
      m.scale.set(Math.max(1e-3, Math.hypot(f.x1 - f.x0, f.y1 - f.y0)), Math.max(1.2 * b.power, FLAME_PX * metresPerPx.value), 1);
      (m.material as THREE.MeshBasicNodeMaterial).opacity = f.opacity;
    }
    for (const p of look.smoke) {
      if (p.opacity <= 0) continue;
      const m = smoke.next();
      m.position.set(p.x, p.y, Z.smoke);
      m.scale.set(p.flip ? -p.size : p.size, p.size, 1);
      m.rotation.z = p.flip ? -Math.PI / 2 : 0;
      m.material.opacity = p.opacity;
      m.frame.value = p.frame;
    }
  }
  for (const p of [...Object.values(glows), flames, smoke]) p.end();
}
