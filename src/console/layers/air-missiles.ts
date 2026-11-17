// #110: lock-on missiles in flight (an AA's, or a jet's at the enemy jet). Each leaves its launcher with a backblast
// (layers/muzzle.ts), climbs off the ground to the altitude of what it chases, its motor glaring, and trails smoke along the
// path it flew, which widens, drifts and fades; its shadow follows on the ground. An `airburst` event ends it: an airburst on
// a hit, a dark puff when it destroys itself. They ride on their launcher's VehicleView, so a missile shows where its launcher
// does; they carry no id, so each is followed from frame to frame by where it is. sprites/air-missile.ts says how it looks.
import * as THREE from 'three/webgpu';
import type { CommanderView, SimEvent, Vec2 } from '../../sim/types';
import { metresPerPx, pool } from '../renderer';
import { BODY_M, type Burst, burstLook, climbed, glare, lifted } from '../sprites/air-missile';
import type { ImpactGlow } from '../sprites/impact';
import { CONTRAIL_MS, layTrail, type Puff, puffLook } from '../sprites/jet';
import { aloft } from '../sprites/missile';
import { spriteMesh } from '../sprites/sheet';
import { SMOKE_PUFF_SHEET, SMOKE_PUFF_VARIANTS } from '../sprites/smoke-puff';
import { addMuzzle } from './muzzle';
import { shade, soft, softRing, streak } from './symbols';

const BODY_PX = 2.5;
const Z = { shadow: 0.43, trail: 0.75, body: 0.77, glare: 0.78, burst: 0.79 }; // over the aircraft
const quad = new THREE.PlaneGeometry(1, 1);

const bodies = pool(() => new THREE.Mesh(quad, shade(0xe8e2c8, 1)));
const shadows = pool(() => new THREE.Mesh(quad, soft(0x000000, { dark: true })));
const glows = {
  glare: pool(() => new THREE.Mesh(quad, soft(0xffb464))),
  core: pool(() => new THREE.Mesh(quad, soft(0xfffaec))),
  flash: pool(() => new THREE.Mesh(quad, soft(0xfff4d6))),
  ring: pool(() => new THREE.Mesh(quad, softRing(0xfff4e0, 0.05))),
};
const fragments = pool(() => new THREE.Mesh(quad, streak(0xffd696)));
const smoke = pool(() => spriteMesh(SMOKE_PUFF_SHEET));
const darkSmoke = pool(() => spriteMesh(SMOKE_PUFF_SHEET, { tint: 0x3a3e40 }));

/** A missile followed across frames: where it was (on the ground), when it was first seen, and the smoke it has laid. */
interface Track extends Vec2 {
  born: number;
  trail: Puff[];
  seen: boolean;
}
let tracks: Track[] = [];
/** Smoke left by missiles that have ended, fading where it hangs. */
let loose: Puff[][] = [];
let bursts: Burst[] = [];
/** A missile first seen this near its launcher has just left it; one seen this near where a track was is that missile. */
const LAUNCH_M = 30;
const SAME_M = 40;
const BURST_MS = 4000;
/** A backblast next to a battery gun's blast. */
const BLAST = 0.5;

export const resetAirMissiles = () => {
  tracks = [];
  loose = [];
  bursts = [];
};

/** A lock-on missile ended at the event's spot: its burst, in the air. */
export function addAirburst(e: Extract<SimEvent, { kind: 'airburst' }>, now: number) {
  const p = aloft(e);
  bursts.push({ x: p.x, y: p.y, at: now, hit: e.hit, seed: bursts.length + Math.round(e.x) });
}

function glow(kind: keyof typeof glows, g: ImpactGlow | null, z: number) {
  if (!g || g.opacity <= 0) return;
  const m = glows[kind].next();
  m.position.set(g.x, g.y, z);
  m.scale.setScalar(g.size);
  (m.material as THREE.MeshBasicNodeMaterial).opacity = g.opacity;
}

function puff(q: Puff, now: number) {
  const look = puffLook((now - q.at) / CONTRAIL_MS);
  const m = smoke.next();
  const flip = q.k % 2 === 1;
  const size = look.size * 0.45;
  m.position.set(q.x, q.y, Z.trail);
  m.scale.set(flip ? -size : size, size, 1);
  m.rotation.z = flip ? -Math.PI / 2 : 0;
  m.material.opacity = look.opacity * 1.4;
  m.frame.value = q.k % SMOKE_PUFF_VARIANTS;
}

export function drawAirMissiles(view: CommanderView, _scale: number, now = performance.now()) {
  for (const t of tracks) t.seen = false;
  for (const v of view.vehicles ?? [])
    for (const s of v.missiles ?? []) {
      let t = tracks.filter((o) => !o.seen && Math.hypot(o.x - s.x, o.y - s.y) < SAME_M).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
      if (!t) {
        const fresh = Math.hypot(v.x - s.x, v.y - s.y) < LAUNCH_M;
        tracks.push((t = { x: s.x, y: s.y, born: fresh ? now : -Infinity, trail: [], seen: true }));
        if (fresh) addMuzzle({ x: v.x, y: v.y, heading: Math.atan2(s.fy, s.fx), at: now, power: BLAST, back: true }); // it has just left the launcher
      }
      Object.assign(t, { x: s.x, y: s.y, seen: true });
      const height = climbed(now - t.born);
      const p = lifted(s, height);
      const tail = { x: p.x - s.fx * BODY_M * 0.6, y: p.y - s.fy * BODY_M * 0.6 };
      t.trail = layTrail(t.trail, tail, now);
      const shadow = shadows.next();
      shadow.position.set(s.x, s.y, Z.shadow);
      shadow.scale.setScalar(5);
      shadow.material.opacity = 0.2 + 0.25 * (1 - height);
      const b = bodies.next();
      b.position.set(p.x, p.y, Z.body);
      b.rotation.z = Math.atan2(s.fy, s.fx);
      b.scale.set(BODY_M, Math.max(0.7, BODY_PX * metresPerPx.value), 1);
      const f = glare(now / 1000);
      glow('glare', { ...tail, size: 9 * f, opacity: 0.8 }, Z.glare);
      glow('core', { ...tail, size: 2.6, opacity: 1 }, Z.glare + 0.005);
    }
  for (const t of tracks) if (!t.seen && t.trail.length) loose.push(t.trail); // ended: its smoke hangs on
  tracks = tracks.filter((t) => t.seen);
  loose = loose.map((trail) => layTrail(trail, null, now)).filter((trail) => trail.length);
  for (const trail of [...tracks.map((t) => t.trail), ...loose]) for (const q of trail) puff(q, now);

  bursts = bursts.filter((b) => now - b.at < BURST_MS);
  for (const b of bursts) {
    const look = burstLook(b, now);
    glow('flash', look.flash, Z.burst);
    glow('ring', look.ring, Z.burst);
    for (const f of look.fragments) {
      const m = fragments.next();
      m.position.set((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, Z.burst);
      m.rotation.z = Math.atan2(f.y1 - f.y0, f.x1 - f.x0);
      m.scale.set(Math.max(1e-3, Math.hypot(f.x1 - f.x0, f.y1 - f.y0)), 1.4 * metresPerPx.value, 1);
      (m.material as THREE.MeshBasicNodeMaterial).opacity = f.opacity;
    }
    for (const p of look.smoke) {
      if (p.opacity <= 0) continue;
      const m = (p.dark ? darkSmoke : smoke).next();
      m.position.set(p.x, p.y, Z.trail);
      m.scale.set(p.flip ? -p.size : p.size, p.size, 1);
      m.rotation.z = p.flip ? -Math.PI / 2 : 0;
      m.material.opacity = p.opacity;
      m.frame.value = p.frame;
    }
  }
  for (const p of [bodies, shadows, ...Object.values(glows), fragments, smoke, darkSmoke]) p.end();
}
