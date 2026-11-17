// Vehicle deaths on the map, fed by `destroyed` events: each death's blasts (handed to layers/impacts.ts when they are due),
// its fires and black smoke, rounds cooking off, thrown parts, a jet's scar, and the smoke a burning aircraft trails on its
// way down. The Wreck itself stays with its vehicle's layer, which asks `deathFor` where to draw it while it falls, is
// kicked or loses its turret. sprites/destruction.ts says how each kind dies.
import * as THREE from 'three/webgpu';
import type { Vec2 } from '../../sim/types';
import { metresPerPx, pool } from '../renderer';
import { blastsOf, type DeathRecord, deathLook, deathOf, type DestroyedEvent, recordDeath } from '../sprites/destruction';
import type { ImpactGlow, ImpactSprite } from '../sprites/impact';
import { CONTRAIL_MS, layTrail, type Puff, puffLook } from '../sprites/jet';
import { spriteMesh } from '../sprites/sheet';
import { SMOKE_PUFF_SHEET, SMOKE_PUFF_VARIANTS } from '../sprites/smoke-puff';
import { addImpact } from './impacts';
import { shade, soft, streak } from './symbols';

/** Black smoke is the grey puff, darkened. */
const SMOKE_TINT = 0x34322f;
const quad = new THREE.PlaneGeometry(1, 1);
const sprites = { smoke: pool(() => spriteMesh(SMOKE_PUFF_SHEET, { tint: SMOKE_TINT })), puff: pool(() => spriteMesh(SMOKE_PUFF_SHEET)) };
const glows = {
  scorch: pool(() => new THREE.Mesh(quad, soft(0x060504, { dark: true }))),
  shadow: pool(() => new THREE.Mesh(quad, soft(0x000000, { dark: true }))),
  fire: pool(() => new THREE.Mesh(quad, soft(0xffa048))),
  flash: pool(() => new THREE.Mesh(quad, soft(0xfffcf0))),
};
const streaks = pool(() => new THREE.Mesh(quad, streak(0xffe6aa)));
const scars = pool(() => new THREE.Mesh(quad, shade(0x080706, 0.5)));
const pieces = pool(() => new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), shade(0x141414, 1)));
// On the ground under the Wrecks (0.44): the scorch and the scar; smoke over the live vehicles and under the aircraft, the
// fires showing through it; an aircraft's own fire burns over its hull (0.74).
const Z = { scorch: 0.33, scar: 0.34, shadow: 0.445, piece: 0.48, smoke: 0.63, puff: 0.64, fire: 0.65, wake: 0.66, flash: 0.68, streak: 0.7, high: 0.76 };
const HOT = new THREE.Color(0xffe6aa);
const DULL = new THREE.Color(0xff7828);
const STREAK_PX = 1.6;

const deaths: DeathRecord[] = [];
/** The smoke each burning aircraft has trailed, by its vehicle id; one no longer fed fades where it was left. */
const wakes = new Map<number, { trail: Puff[]; fed: boolean }>();
/** How far each helicopter bailed out of has turned, by id (layers/helicopter.ts): its fall goes on from there. */
const glides = new Map<number, number>();

export const resetDeaths = () => {
  deaths.length = 0;
  wakes.clear();
  glides.clear();
};

export const addDeath = (e: DestroyedEvent, now: number) => recordDeath(deaths, e, now, glides.get(e.id) ?? 0);
/** The death of the Wreck `w`, while it is kept: its layer draws the Wreck by it. */
export const deathFor = (w: { kind: string } & Vec2) => deathOf(deaths, w);
export const glideTurn = (id: number, turn: number) => void glides.set(id, turn);

/** The aircraft `id` burns at `p` this frame: its smoke follows the way it came. */
export function layWake(id: number, p: Vec2, now: number) {
  const w = wakes.get(id) ?? { trail: [], fed: false };
  wakes.set(id, { trail: layTrail(w.trail, p, now), fed: true });
}

function glow(kind: keyof typeof glows, g: ImpactGlow, z: number) {
  if (g.opacity <= 0) return;
  const m = glows[kind].next();
  m.position.set(g.x, g.y, z);
  m.scale.setScalar(g.size);
  (m.material as THREE.MeshBasicNodeMaterial).opacity = g.opacity;
}

function sprite(kind: keyof typeof sprites, s: ImpactSprite, z: number) {
  if (s.opacity <= 0) return;
  const m = sprites[kind].next();
  m.position.set(s.x, s.y, z);
  // Mirrored across the NE-SW diagonal, as the impact plume's: the baked sun stays put.
  m.scale.set(s.flip ? -s.size : s.size, s.size, 1);
  m.rotation.z = s.flip ? -Math.PI / 2 : 0;
  m.material.opacity = s.opacity;
  m.frame.value = s.frame;
}

function line(mesh: THREE.Mesh, x0: number, y0: number, x1: number, y1: number, width: number, z: number) {
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
  mesh.rotation.z = Math.atan2(y1 - y0, x1 - x0);
  mesh.scale.set(Math.max(1e-3, Math.hypot(x1 - x0, y1 - y0)), width, 1);
}

export function drawDestruction(now: number) {
  for (const d of deaths) {
    const due = blastsOf(d);
    while (d.blasts < due.length && now - d.at >= due[d.blasts]!.ms) {
      const b = due[d.blasts++]!;
      addImpact(b.x, b.y, now, 'tank', b.size);
    }
    const look = deathLook(d, now);
    if (look.scorch) glow('scorch', look.scorch, Z.scorch);
    if (look.scar) {
      const m = scars.next();
      line(m, look.scar.x0, look.scar.y0, look.scar.x1, look.scar.y1, look.scar.width, Z.scar);
      (m.material as THREE.MeshBasicNodeMaterial).opacity = look.scar.opacity;
    }
    for (const p of look.pieces) {
      glow('shadow', { ...p.shadow, size: p.size * 1.8, opacity: 0.5 }, Z.shadow);
      const m = pieces.next();
      m.position.set(p.x, p.y, Z.piece);
      m.scale.setScalar(p.size);
    }
    for (const f of look.fires) glow('fire', f, f.high ? Z.high : Z.fire);
    for (const s of look.smoke) sprite('smoke', s, Z.smoke);
    for (const s of look.puffs) sprite('puff', s, Z.puff);
    for (const f of look.flashes) glow('flash', f, Z.flash);
    for (const s of look.streaks) {
      const m = streaks.next();
      line(m, s.x0, s.y0, s.x1, s.y1, STREAK_PX * metresPerPx.value, Z.streak);
      const material = m.material as THREE.MeshBasicNodeMaterial;
      material.color.lerpColors(DULL, HOT, s.heat);
      material.opacity = s.opacity;
    }
  }
  for (const [id, w] of wakes) {
    const trail = w.fed ? w.trail : layTrail(w.trail, null, now);
    if (!trail.length) wakes.delete(id);
    else wakes.set(id, { trail, fed: false });
    for (const q of trail) {
      const look = puffLook((now - q.at) / CONTRAIL_MS);
      sprite('smoke', { x: q.x, y: q.y, size: look.size * 0.7, frame: q.k % SMOKE_PUFF_VARIANTS, flip: q.k % 2 === 1, opacity: look.opacity * 2 }, Z.wake);
    }
  }
  for (const p of [...Object.values(sprites), ...Object.values(glows), streaks, scars, pieces]) p.end();
}
