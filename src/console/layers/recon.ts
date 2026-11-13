// The Recon Plane on the map (#139), own ones and the enemy's (the sky rule): the baked aircraft at the nearest heading,
// lifted north-east of its ground shadow to the Cruise Missile's altitude, straight and level, its bracketed tactical icon
// (edge-clamped while it is off screen, layers/sky-icon.ts), and, to its own Commander, the sweep band under it: as wide
// as it reveals, fading behind. Shot down, it falls onto its shadow and fades, band and icon gone. The preview strip and
// the label are layers/effects.ts'. sprites/recon.ts says where everything is.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { pool, sideColor } from '../renderer';
import { RECON_OUTLINE, RECON_SHADOW_FRAME, RECON_SHEET, reconsInFlight, sweepBand } from '../sprites/recon';
import { spriteMesh } from '../sprites/sheet';
import { skyIcons } from './sky-icon';
import { fading } from './symbols';

const Z = { band: 0.48, shadow: 0.43, body: 0.74 };
const SHADOW_OPACITY = 0.42;
const quad = new THREE.PlaneGeometry(1, 1);

const shadows = pool(() => spriteMesh(RECON_SHEET, { frame: RECON_SHADOW_FRAME, shadow: true, opacity: SHADOW_OPACITY }));
const bodies = pool(() => spriteMesh(RECON_SHEET));
const bands = pool(() => new THREE.Mesh(quad, fading(0xffffff)));
const icons = skyIcons(RECON_OUTLINE);

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicNodeMaterial;

/** `scale` is the chevron size in metres (constant on screen), for the icon. */
export function drawRecons(view: CommanderView, scale: number) {
  for (const r of reconsInFlight(view.effects)) {
    for (const step of sweepBand(r.e)) {
      const b = bands.next();
      const [dx, dy] = [step.to.x - step.from.x, step.to.y - step.from.y];
      b.position.set((step.from.x + step.to.x) / 2, (step.from.y + step.to.y) / 2, Z.band);
      b.rotation.z = Math.atan2(dy, dx);
      b.scale.set(Math.hypot(dx, dy), step.width, 1);
      material(b).color.setHex(sideColor(r.side));
      material(b).opacity = step.opacity;
    }
    const s = shadows.next();
    s.position.set(r.shadow.x, r.shadow.y, Z.shadow);
    s.rotation.z = r.shadow.rotation;
    s.scale.setScalar(r.size);
    s.material.opacity = SHADOW_OPACITY * r.opacity;
    const b = bodies.next();
    b.position.set(r.x, r.y, Z.body);
    b.rotation.z = r.rotation;
    b.scale.setScalar(r.size);
    b.frame.value = r.frame;
    b.material.opacity = r.opacity;
    if (!r.lost) icons.place(r, { x: r.e.x, y: r.e.y }, r.heading, r.side, scale);
  }
  for (const q of [shadows, bodies, bands, icons]) q.end();
}
