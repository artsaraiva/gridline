// Asset effects on the map: the armed Asset's preview ring (with its grid and the distance to the nearest friendly
// Squad) and each working Asset's ring with its time left; the baked Scan UAV circles its ring. Labels are DOM tags over the
// canvas and keep clear of the map Confirm button.
import * as THREE from 'three/webgpu';
import { gridRef } from '../../sim/grid-ref';
import type { CommanderView, Vec2 } from '../../sim/types';
import { COLOR, layer, toScreen } from '../renderer';
import { session } from '../session';
import { barrageShells, scanUav, SHELL_SHADOW_FRAME, shellTrail, spriteMaterial, UAV_SHADOW_FRAME } from '../sprites';
import { clock } from '../summary';
import { overlaps, targeting, validSpot } from '../targeting';
import { css, dashedRing, fading, shade } from './symbols';

const crateGeometry = new THREE.PlaneGeometry(1, 1);
const NAME = { scan: 'Scan UAV', supply: 'Supply Drop', barrage: 'Barrage' };
const discGeometry = new THREE.CircleGeometry(1, 96);
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
// Tactical UAV symbol: a straight-winged airframe seen from above (wide wing bar, fuselage, tail bar), pointing +y.
const uavIconShape = new THREE.Shape(
  [
    [0, 0.5], [0.09, 0.36], [0.09, 0.16], [0.62, 0.16], [0.62, 0], [0.09, 0], [0.07, -0.32], [0.28, -0.34], [0.28, -0.48],
    [-0.28, -0.48], [-0.28, -0.34], [-0.07, -0.32], [-0.09, 0], [-0.62, 0], [-0.62, 0.16], [-0.09, 0.16], [-0.09, 0.36],
  ].map(([x, y]) => new THREE.Vector2(x, y)),
);
const uavIconGeometry = new THREE.ShapeGeometry(uavIconShape);
const uavHaloGeometry = uavIconGeometry.clone().scale(1.22, 1.3, 1).translate(0, 0, -0.02);

/** A ring, a faint disc and markers, pooled: rings carry no id, so they are reused in draw order. */
type Ring = { group: THREE.Group; ring: ReturnType<typeof dashedRing>; disc: THREE.Mesh; crate: THREE.Mesh };
type ShellMark = {
  shadow: THREE.Mesh;
  shadowMat: THREE.MeshBasicNodeMaterial;
  body: THREE.Mesh;
  frame: ReturnType<typeof spriteMaterial>['frame'];
  icon: THREE.Mesh;
};
type UavMark = { shadow: THREE.Mesh; body: THREE.Mesh; frame: ReturnType<typeof spriteMaterial>['frame']; icon: THREE.Mesh };
const pool: Ring[] = [];
const shellPool: ShellMark[] = [];
const uavPool: UavMark[] = [];
type Puff = { mesh: THREE.Mesh; material: THREE.MeshBasicNodeMaterial; frame: ReturnType<typeof spriteMaterial>['frame'] };
const puffPool: Puff[] = [];
const labelBox = document.getElementById('labels')!;
const labels: HTMLElement[] = [];

export const resetEffects = () => {
  pool.length = 0;
  shellPool.length = 0;
  uavPool.length = 0;
  puffPool.length = 0;
};

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicMaterial;

function ringAt(i: number, p: Vec2, radius: number, color: number, fill: number): Ring {
  let r = pool[i];
  if (!r) {
    r = {
      group: new THREE.Group(),
      ring: dashedRing(120, color, { dash: 2, gap: 6, width: 2 }),
      disc: new THREE.Mesh(discGeometry, fading(color, fill)),
      crate: new THREE.Mesh(crateGeometry, fading(color)),
    };
    r.group.add(r.disc, r.ring.mesh, r.crate);
    layer.add(r.group);
    pool.push(r);
  }
  r.group.visible = true;
  r.group.position.set(p.x, p.y, 0.5);
  r.disc.scale.setScalar(radius);
  r.ring.r.value = radius;
  r.ring.alpha.value = 0.85;
  r.ring.tint.value.setHex(color);
  material(r.disc).color.setHex(color);
  material(r.disc).opacity = fill;
  material(r.crate).color.setHex(color);
  r.crate.visible = false;
  return r;
}

function shellAt(i: number): ShellMark {
  let s = shellPool[i];
  if (!s) {
    const shadow = spriteMaterial('artillery-shell', { frame: SHELL_SHADOW_FRAME, shadow: true });
    const body = spriteMaterial('artillery-shell');
    const icon = new THREE.Mesh(shellIconGeometry, fading(COLOR.hostile));
    icon.add(new THREE.Mesh(shellHaloGeometry, shade(0x000000, 0.75)));
    s = {
      shadow: new THREE.Mesh(crateGeometry, shadow.material),
      shadowMat: shadow.material,
      body: new THREE.Mesh(crateGeometry, body.material),
      frame: body.frame,
      icon,
    };
    layer.add(s.shadow, s.body, s.icon);
    shellPool.push(s);
  }
  s.shadow.visible = true;
  s.body.visible = true;
  s.icon.visible = true;
  return s;
}

function uavAt(i: number): UavMark {
  let u = uavPool[i];
  if (!u) {
    const body = spriteMaterial('scan-uav');
    const icon = new THREE.Mesh(uavIconGeometry, fading(COLOR.friendly));
    icon.add(new THREE.Mesh(uavHaloGeometry, shade(0x000000, 0.75)));
    u = {
      shadow: new THREE.Mesh(crateGeometry, spriteMaterial('scan-uav', { frame: UAV_SHADOW_FRAME, shadow: true, opacity: 0.42 }).material),
      body: new THREE.Mesh(crateGeometry, body.material),
      frame: body.frame,
      icon,
    };
    layer.add(u.shadow, u.body, u.icon);
    uavPool.push(u);
  }
  u.shadow.visible = u.body.visible = u.icon.visible = true;
  return u;
}

function puffAt(i: number): Puff {
  let p = puffPool[i];
  if (!p) {
    const { material, frame } = spriteMaterial('smoke-puff');
    p = { mesh: new THREE.Mesh(crateGeometry, material), material, frame };
    layer.add(p.mesh);
    puffPool.push(p);
  }
  p.mesh.visible = true;
  return p;
}

/** Places tag `i` at the world spot `p`, offset in px; moved above the map Confirm button if it would sit under it. */
function label(i: number, p: Vec2, dx: number, dy: number, text: string, color: string) {
  let el = labels[i];
  if (!el) {
    el = labelBox.appendChild(document.createElement('span'));
    labels.push(el);
  }
  el.hidden = false;
  el.textContent = text;
  el.style.color = color;
  const s = toScreen(p);
  let x = s.x + dx;
  let y = s.y + dy;
  const confirm = document.getElementById('confirm')!;
  if (!confirm.hidden) {
    const c = confirm.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (overlaps({ left: x, top: y, right: x + w, bottom: y + h }, c)) y = c.top - h - 4;
  }
  el.style.transform = `translate(${x}px, ${y}px)`;
}

/** `scale` is the chevron size in metres (constant on screen), used for the UAV and shell icons. */
export function drawEffects(view: CommanderView, scale: number, now: number) {
  let rings = 0;
  let shells = 0;
  let uavs = 0;
  let puffs = 0;
  let tags = 0;
  for (const e of view.effects ?? []) {
    const danger = e.asset === 'barrage';
    const r = ringAt(rings++, e, e.radius, danger ? COLOR.hostile : COLOR.friendly, danger ? 0.1 : 0.06);
    if (e.asset === 'scan') {
      const u = scanUav(e, e.radius, now / 1000);
      const m = uavAt(uavs++);
      m.shadow.position.set(u.shadow.x, u.shadow.y, 0.42);
      m.shadow.rotation.z = u.shadow.rotation;
      m.shadow.scale.setScalar(u.size);
      m.body.position.set(u.x, u.y, 0.72);
      m.body.rotation.z = u.rotation;
      m.body.scale.setScalar(u.size);
      m.frame.value = u.frame;
      // Icon rides just outside the orbit, clear of the aircraft at close zoom and on it at overview.
      const off = Math.max(scale * 1.1, u.size * 0.75);
      m.icon.position.set(u.x + Math.sin(u.heading) * off, u.y - Math.cos(u.heading) * off, 0.92);
      m.icon.rotation.z = u.heading - Math.PI / 2;
      m.icon.scale.setScalar(scale * 1.1);
    }
    let time = clock(Math.ceil(e.left));
    if (e.landsIn !== undefined && e.fall) { // a Supply Drop crate: it drops toward its spot, growing smaller and brighter, then sits
      const high = e.landsIn / e.fall;
      r.crate.visible = true;
      r.crate.scale.setScalar(scale * (1.2 + high));
      r.crate.position.set(0, high * 40, 0.1);
      material(r.crate).opacity = 1 - 0.6 * high;
      r.ring.alpha.value = 0.35 + 0.5 * (1 - high);
      if (high) time = `LANDS ${clock(Math.ceil(e.landsIn))}`;
    }
    if (e.impactIn) time = `IMPACT ${clock(Math.ceil(e.impactIn))}`; // the Barrage counts down to its first shell
    label(tags++, { x: e.x + e.radius * 0.72, y: e.y + e.radius * 0.72 }, 6, -18, `${NAME[e.asset].toUpperCase()} ${time}`, css(danger ? COLOR.hostile : COLOR.friendly));
  }
  const map = session.host?.map;
  if (map) {
    for (const s of barrageShells(view, map)) {
      for (const t of shellTrail(s.from, s.to, s.flight)) {
        const p = puffAt(puffs++);
        p.mesh.position.set(t.x, t.y, 0.6);
        p.mesh.scale.setScalar(t.size);
        p.material.opacity = t.opacity;
        p.frame.value = t.frame;
      }
      const m = shellAt(shells++);
      m.shadow.position.set(s.shadow.x, s.shadow.y, 0.42);
      m.shadow.rotation.z = s.rotation;
      m.shadow.scale.setScalar(s.shadow.size);
      m.shadowMat.opacity = s.shadow.opacity;
      m.body.position.set(s.x, s.y, 0.72);
      m.body.rotation.z = s.rotation;
      m.body.scale.setScalar(s.size);
      m.frame.value = s.pitchFrame;
      const nx = -Math.sin(s.heading);
      const ny = Math.cos(s.heading);
      m.icon.position.set(s.x + nx * scale * 0.75, s.y + ny * scale * 0.75, 0.92);
      m.icon.rotation.z = s.rotation;
      m.icon.scale.setScalar(scale * 0.85);
    }
  }
  const at = targeting.armed && (targeting.spot ?? targeting.pointer);
  const radius = targeting.armed && view.assets?.find((a) => a.asset === targeting.armed)?.radius;
  if (at && radius) {
    const color = validSpot(at) ? COLOR.bone : COLOR.hostile;
    ringAt(rings++, at, radius, color, targeting.spot ? 0.12 : 0.06);
    const edge = { x: at.x + radius * 0.72, y: at.y + radius * 0.72 };
    const g = session.host?.map.grid;
    label(tags++, edge, 6, -18, `${NAME[targeting.armed!].toUpperCase()} ${g ? gridRef(g, at) : ''}`, css(color));
    const near = nearestSquad(view, at);
    if (near) label(tags++, edge, 6, 2, `${near.name.toUpperCase()} ${Math.round(near.d)} M`, css(color));
  }
  for (let i = rings; i < pool.length; i++) pool[i]!.group.visible = false;
  for (let i = uavs; i < uavPool.length; i++) {
    const m = uavPool[i]!;
    m.shadow.visible = m.body.visible = m.icon.visible = false;
  }
  for (let i = puffs; i < puffPool.length; i++) puffPool[i]!.mesh.visible = false;
  for (let i = shells; i < shellPool.length; i++) {
    const m = shellPool[i]!;
    m.shadow.visible = false;
    m.body.visible = false;
    m.icon.visible = false;
  }
  for (let i = tags; i < labels.length; i++) labels[i]!.hidden = true;
}

/** The friendly Squad with a Soldier nearest `p`, and that distance in metres. */
function nearestSquad(view: CommanderView, p: Vec2) {
  let best: { name: string; d: number } | null = null;
  for (const f of view.friendlies) {
    const d = Math.sqrt((f.x - p.x) ** 2 + (f.y - p.y) ** 2);
    if (best && d >= best.d) continue;
    best = { name: view.squads.find((q) => q.id === f.squad)?.name ?? '', d };
  }
  return best;
}

/** Hides every tag (between matches). */
export const hideEffectLabels = () => labels.forEach((el) => (el.hidden = true));
