// Barrage impacts as baked sprites (#62): the explosion flipbook, then a smoke plume that drifts and fades, and a
// crater decal that stays for the match. Round the flipbook, the blast layers: a white flash and the light it throws, a
// shock ring, debris and embers, dust, and a scorch whose heat cools.
// Fed by `impact` events; the sim says where, sprites/impact.ts says how it looks.
import * as THREE from 'three/webgpu';
import { metresPerPx, pool } from '../renderer';
import { CRATER_SHEET, EXPLOSION_SHEET, type ImpactAsset, type ImpactGlow, type ImpactRecord, type ImpactSprite, impactLook, recordImpact } from '../sprites/impact';
import { spriteMesh } from '../sprites/sheet';
import { SMOKE_PUFF_SHEET } from '../sprites/smoke-puff';
import { soft, softRing, streak } from './symbols';

const pools = { crater: pool(() => spriteMesh(CRATER_SHEET)), explosion: pool(() => spriteMesh(EXPLOSION_SHEET)), plume: pool(() => spriteMesh(SMOKE_PUFF_SHEET)) };
const quad = new THREE.PlaneGeometry(1, 1);
const HOT = new THREE.Color(0xffe6aa);
const DULL = new THREE.Color(0xff7828);
const glows = {
  scorch: pool(() => new THREE.Mesh(quad, soft(0x060504, { dark: true }))),
  heat: pool(() => new THREE.Mesh(quad, soft(0xff7828))),
  dust: pool(() => new THREE.Mesh(quad, soft(0xbeb4a0, { glow: false }))),
  light: pool(() => new THREE.Mesh(quad, soft(0xffce8c))),
  flash: pool(() => new THREE.Mesh(quad, soft(0xfffcf0))),
  ring: pool(() => new THREE.Mesh(quad, softRing(0xfff4e0, 0.022))),
  ember: pool(() => new THREE.Mesh(quad, soft(0xffaa50))),
  fire: pool(() => new THREE.Mesh(quad, soft(0xffb060))),
};
const debris = pool(() => new THREE.Mesh(quad, streak(0xffe6aa)));
const Z = { scorch: 0.29, crater: 0.3, heat: 0.31, fire: 0.32, dust: 0.6, plume: 0.62, explosion: 0.66, light: 0.67, flash: 0.68, ring: 0.69, ember: 0.7, debris: 0.7 };
/** A debris streak's width on screen. */
const DEBRIS_PX = 1.4;

const impacts: ImpactRecord[] = [];

export const resetImpacts = () => {
  impacts.length = 0;
};

export const addImpact = (x: number, y: number, now: number, asset: ImpactAsset) => recordImpact(impacts, x, y, now, asset);
/** When the latest impact of `asset` landed, in ms; -Infinity before the first. */
export const lastImpactAt = (asset: ImpactAsset) => impacts.filter((i) => i.asset === asset).at(-1)?.at ?? -Infinity;
/** The impacts of `asset` in the last `ms` ms, oldest first. */
export const recentImpacts = (now: number, ms: number, asset: ImpactAsset) => impacts.filter((i) => i.asset === asset && now - i.at < ms);

function place(kind: keyof typeof pools, s: ImpactSprite) {
  const p = pools[kind].next();
  p.position.set(s.x, s.y, Z[kind]);
  // Mirror across the NE-SW diagonal (flip x, turn a quarter): keeps the baked north-east sun where it is.
  p.scale.set(s.flip ? -s.size : s.size, s.size, 1);
  p.rotation.z = s.flip ? -Math.PI / 2 : 0;
  p.material.opacity = s.opacity;
  p.frame.value = s.frame;
}

function glow(kind: keyof typeof glows, g: ImpactGlow | null) {
  if (!g || g.opacity <= 0) return;
  const m = glows[kind].next();
  m.position.set(g.x, g.y, Z[kind]);
  m.scale.setScalar(g.size);
  (m.material as THREE.MeshBasicNodeMaterial).opacity = g.opacity;
}

export function drawImpacts(now: number) {
  for (const i of impacts) {
    const look = impactLook(i, now);
    glow('scorch', look.scorch);
    place('crater', look.crater);
    glow('heat', look.heat);
    for (const f of look.fires) glow('fire', f);
    glow('dust', look.dust);
    for (const p of look.plume) if (p.opacity > 0) place('plume', p);
    if (look.explosion) place('explosion', look.explosion);
    glow('light', look.light);
    glow('flash', look.flash);
    for (const r of look.rings) glow('ring', r);
    for (const e of look.embers) glow('ember', e);
    for (const d of look.debris) {
      const m = debris.next();
      m.position.set((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, Z.debris);
      m.rotation.z = Math.atan2(d.y1 - d.y0, d.x1 - d.x0);
      m.scale.set(Math.max(1e-3, Math.hypot(d.x1 - d.x0, d.y1 - d.y0)), DEBRIS_PX * metresPerPx.value, 1);
      const material = m.material as THREE.MeshBasicNodeMaterial;
      material.color.lerpColors(DULL, HOT, d.heat);
      material.opacity = d.opacity;
    }
  }
  for (const p of [...Object.values(pools), ...Object.values(glows), debris]) p.end();
}
