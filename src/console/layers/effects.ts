// Asset effects on the map: the armed Asset's preview ring (with its grid and the distance to the nearest friendly
// Squad) and each working Asset's ring with its time left; the baked Scan UAV circles its ring, the Supply Drop
// crate comes down under its canopy, and Barrage shells streak in from the sky while its ring turns (#98). Labels are
// DOM tags over the canvas and keep clear of the map Confirm button.
import * as THREE from 'three/webgpu';
import { uv } from 'three/tsl';
import { gridRef } from '../../sim/grid-ref';
import type { CommanderView, Vec2 } from '../../sim/types';
import { BRIGHT, COLOR, GLOW, layer, metresPerPx, toScreen } from '../renderer';
import { session } from '../session';
import {
  barrageShells,
  scanUav,
  SHELL_VISIBLE_FROM,
  shellStreak,
  spriteMaterial,
  SUPPLY_SHADOW_FRAME,
  supplyDrop,
  type SupplyDropPose,
  UAV_SHADOW_FRAME,
} from '../sprites';
import { clock } from '../summary';
import { overlaps, targeting, validSpot } from '../targeting';
import { css, dashedRing, fading, shade } from './symbols';

const quadGeometry = new THREE.PlaneGeometry(1, 1);
const NAME = { scan: 'Scan UAV', supply: 'Supply Drop', barrage: 'Barrage' };
const discGeometry = new THREE.CircleGeometry(1, 96);
// Tactical UAV symbol: a straight-winged airframe seen from above (wide wing bar, fuselage, tail bar), pointing +y.
const uavIconShape = new THREE.Shape(
  [
    [0, 0.5], [0.09, 0.36], [0.09, 0.16], [0.62, 0.16], [0.62, 0], [0.09, 0], [0.07, -0.32], [0.28, -0.34], [0.28, -0.48],
    [-0.28, -0.48], [-0.28, -0.34], [-0.07, -0.32], [-0.09, 0], [-0.62, 0], [-0.62, 0.16], [-0.09, 0.16], [-0.09, 0.36],
  ].map(([x, y]) => new THREE.Vector2(x, y)),
);
const uavIconGeometry = new THREE.ShapeGeometry(uavIconShape);
const uavHaloGeometry = uavIconGeometry.clone().scale(1.22, 1.3, 1).translate(0, 0, -0.02);
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


/** A ring, a faint disc and markers, pooled: rings carry no id, so they are reused in draw order. */
type Ring = { group: THREE.Group; ring: ReturnType<typeof dashedRing>; disc: THREE.Mesh };
type ShellMark = { body: THREE.Mesh; frame: ReturnType<typeof spriteMaterial>['frame']; streak: THREE.Mesh };
/** The Barrage ring turns this fast while it works, so an ongoing strike reads at a glance. */
const RING_TURN_RAD_PER_S = 0.25;
/** The streak is this wide on screen, whatever the zoom. */
const STREAK_PX = 2.5;
type UavMark = { shadow: THREE.Mesh; body: THREE.Mesh; frame: ReturnType<typeof spriteMaterial>['frame']; icon: THREE.Mesh };
type DropMark = {
  shadow: THREE.Mesh;
  shadowMat: THREE.MeshBasicNodeMaterial;
  body: THREE.Mesh;
  frame: ReturnType<typeof spriteMaterial>['frame'];
  icon: THREE.Group;
};
const pool: Ring[] = [];
const shellPool: ShellMark[] = [];
const uavPool: UavMark[] = [];
const dropPool: DropMark[] = [];
const labelBox = document.getElementById('labels')!;
const labels: HTMLElement[] = [];

export const resetEffects = () => {
  pool.length = 0;
  shellPool.length = 0;
  uavPool.length = 0;
  dropPool.length = 0;
};

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicMaterial;

function ringAt(i: number, p: Vec2, radius: number, color: number, fill: number): Ring {
  let r = pool[i];
  if (!r) {
    r = {
      group: new THREE.Group(),
      ring: dashedRing(120, color, { dash: 2, gap: 6, width: 2 }),
      disc: new THREE.Mesh(discGeometry, fading(color, fill)),
    };
    r.group.add(r.disc, r.ring.mesh);
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
  return r;
}

/** A thin bright line, brightest at its head (uv.x = 1) and fading to nothing at its tail. */
function streakMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ color: COLOR.bone, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.opacityNode = BRIGHT.mul(uv().x.mul(0.15).add(0.85).mul(uv().x.pow(0.6)));
  material.mrtNode = GLOW();
  return material;
}

function shellAt(i: number): ShellMark {
  let s = shellPool[i];
  if (!s) {
    const body = spriteMaterial('artillery-shell');
    s = { body: new THREE.Mesh(quadGeometry, body.material), frame: body.frame, streak: new THREE.Mesh(quadGeometry, streakMaterial()) };
    layer.add(s.streak, s.body);
    shellPool.push(s);
  }
  s.body.visible = true;
  s.streak.visible = true;
  return s;
}

function uavAt(i: number): UavMark {
  let u = uavPool[i];
  if (!u) {
    const body = spriteMaterial('scan-uav');
    const icon = new THREE.Mesh(uavIconGeometry, fading(COLOR.friendly));
    icon.add(new THREE.Mesh(uavHaloGeometry, shade(0x000000, 0.75)));
    u = {
      shadow: new THREE.Mesh(quadGeometry, spriteMaterial('scan-uav', { frame: UAV_SHADOW_FRAME, shadow: true, opacity: 0.42 }).material),
      body: new THREE.Mesh(quadGeometry, body.material),
      frame: body.frame,
      icon,
    };
    layer.add(u.shadow, u.body, u.icon);
    uavPool.push(u);
  }
  u.shadow.visible = u.body.visible = u.icon.visible = true;
  return u;
}

/** Draws Supply Drop `i`: the baked crate under its canopy with its ground shadow while falling, then the landed crate. */
function dropAt(i: number, d: SupplyDropPose, scale: number) {
  let m = dropPool[i];
  if (!m) {
    const shadow = spriteMaterial('supply-drop', { frame: SUPPLY_SHADOW_FRAME, shadow: true });
    const body = spriteMaterial('supply-drop');
    const canopy = new THREE.Mesh(canopyIconGeometry, fading(COLOR.friendly));
    canopy.add(halo(canopyIconGeometry, 1.3));
    const crate = new THREE.Mesh(crateIconGeometry, fading(COLOR.friendly));
    crate.add(halo(crateIconGeometry, 1.45));
    const icon = new THREE.Group().add(canopy, crate);
    m = { shadow: new THREE.Mesh(quadGeometry, shadow.material), shadowMat: shadow.material, body: new THREE.Mesh(quadGeometry, body.material), frame: body.frame, icon };
    layer.add(m.shadow, m.body, m.icon);
    dropPool.push(m);
  }
  m.body.visible = m.icon.visible = true;
  m.shadow.visible = !d.landed;
  m.shadow.position.set(d.shadow.x, d.shadow.y, 0.43);
  m.shadow.scale.setScalar(d.shadow.size);
  m.shadowMat.opacity = d.shadow.opacity;
  m.body.position.set(d.x, d.y, d.landed ? 0.45 : 0.75);
  m.body.scale.setScalar(d.size);
  m.frame.value = d.frame;
  // Constant screen size, just west of the crate so it never sits on the canopy (north-east of the crate).
  m.icon.position.set(d.crate.x - d.size * 0.12 - scale * 1.2, d.crate.y, 0.92);
  m.icon.scale.setScalar(scale * 1.3);
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
  let drops = 0;
  let tags = 0;
  for (const e of view.effects ?? []) {
    const danger = e.asset === 'barrage';
    const r = ringAt(rings++, e, e.radius, danger ? COLOR.hostile : COLOR.friendly, danger ? 0.1 : 0.06);
    r.ring.mesh.rotation.z = danger ? (now / 1000) * RING_TURN_RAD_PER_S : 0; // the Barrage ring turns while it works
    if (danger) {
      // and brightens as each shell comes down, so every impact pulses it
      const falling = Math.max(0, ...(e.shells ?? []).map((s) => (s.flight - SHELL_VISIBLE_FROM) / (1 - SHELL_VISIBLE_FROM)));
      r.ring.alpha.value = 0.7 + 0.3 * falling;
    }
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
    if (e.landsIn !== undefined && e.fall) { // a Supply Drop crate: it comes down under its canopy, then sits on its spot
      const high = e.landsIn / e.fall;
      dropAt(drops++, supplyDrop({ x: e.x, y: e.y, landsIn: e.landsIn, fall: e.fall }), scale);
      r.ring.alpha.value = 0.35 + 0.5 * (1 - high);
      if (high) time = `LANDS ${clock(Math.ceil(e.landsIn))}`;
    }
    if (e.impactIn) time = `IMPACT ${clock(Math.ceil(e.impactIn))}`; // the Barrage counts down to its first shell
    label(tags++, { x: e.x + e.radius * 0.72, y: e.y + e.radius * 0.72 }, 6, -18, `${NAME[e.asset].toUpperCase()} ${time}`, css(danger ? COLOR.hostile : COLOR.friendly));
  }
  const map = session.host?.map;
  if (map) {
    for (const s of barrageShells(view, map)) {
      const m = shellAt(shells++);
      const t = shellStreak(s.from, s.to, s.flight);
      m.streak.position.set((t.tail.x + t.head.x) / 2, (t.tail.y + t.head.y) / 2, 0.6);
      m.streak.rotation.z = t.angle;
      m.streak.scale.set(t.length, STREAK_PX * metresPerPx.value, 1);
      m.body.position.set(s.x, s.y, 0.72);
      m.body.rotation.z = s.bodyRotation;
      m.body.scale.setScalar(s.size);
      m.frame.value = s.frame;
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
  for (let i = drops; i < dropPool.length; i++) {
    const m = dropPool[i]!;
    m.shadow.visible = m.body.visible = m.icon.visible = false;
  }
  for (let i = shells; i < shellPool.length; i++) {
    const m = shellPool[i]!;
    m.body.visible = false;
    m.streak.visible = false;
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
