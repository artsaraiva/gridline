// The EMP Strike on the map (#143), own ones and the enemy's (the sky rule). In the air: the baked missile at the nearest heading,
// lifted north-east of its ground shadow to the Cruise Missile's altitude, a thin short contrail along the path it flew, its
// bracketed tactical icon (edge-clamped off screen, layers/sky-icon.ts), and a bright line from it to the spot's mark and ring, as
// the Drone Strike's. At the burst a white-blue disc as wide as the ring collapses to nothing in half a second under a bright core
// up where it burst; then the ring stays, faint, while the EMP holds. Over every vehicle it holds (`disabled`: own, or the enemy's
// in sight) short white-blue sparks crackle, and a bolt sits by its tactical icon, which the vehicle's own layer dims.
// sprites/emp.ts says where everything is.
import * as THREE from 'three/webgpu';
import type { CommanderView, VehicleView } from '../../sim/types';
import { metresPerPx, pool, sideColor } from '../renderer';
import { BOLT_OUTLINE, burstAt, crackle, EMP_BLUE, EMP_OUTLINE, EMP_SHADOW_FRAME, EMP_SHEET, empFlash, empRing, empsInFlight, HULL_M } from '../sprites/emp';
import { lifted } from '../sprites/level-flight';
import { spriteMesh } from '../sprites/sheet';
import { skyIcons } from './sky-icon';
import { dashedRing, fading, frameFill, frameOutline, merge, px, shade, streak } from './symbols';

const Z = { shadow: 0.42, flash: 0.49, ring: 0.5, line: 0.56, trail: 0.6, body: 0.72, spark: 0.8, core: 0.85, marker: 0.9, bolt: 0.94 };
/** The line to its spot, as the Drone Strike's. */
const LINE = { px: 1.5, opacity: 0.85 };
const SHADOW_OPACITY = 0.42;
const TRAIL = { px: 1.5, opacity: 0.45 };
const MARK_OPACITY = 0.9;
const AIM_RING_OPACITY = 0.35;
/** How strong the flash disc is at its brightest: a wash over the ring, not a wall. */
const FLASH_OPACITY = 0.55;
/** The core up where it burst, in chevrons at its brightest. */
const CORE_SCALE = 1.6;
const SPARK_PX = 1.6;

const markGeometry = merge([frameOutline('friendly', 0.34, px(1.5)), frameFill('friendly', 0.12)]);
const quad = new THREE.PlaneGeometry(1, 1);
const disc = new THREE.CircleGeometry(1, 64);
const boltGeometry = new THREE.ShapeGeometry(new THREE.Shape(BOLT_OUTLINE.map(([x, y]) => new THREE.Vector2(x, y))));
const boltHalo = boltGeometry.clone().scale(1.3, 1.18, 1).translate(0, 0, -0.01);

const shadows = pool(() => spriteMesh(EMP_SHEET, { frame: EMP_SHADOW_FRAME, shadow: true, opacity: SHADOW_OPACITY }));
const bodies = pool(() => spriteMesh(EMP_SHEET));
const trails = pool(() => new THREE.Mesh(quad, streak()));
const lines = pool(() => new THREE.Mesh(quad, fading(0xffffff, LINE.opacity)));
const marks = pool(() => new THREE.Mesh(markGeometry, fading(0xffffff, MARK_OPACITY)));
const rings = pool(() => {
  const ring = dashedRing(80, 0xffffff, { dash: 3, gap: 5, width: 1.5, opacity: AIM_RING_OPACITY }); // a quad big enough for its ring
  return Object.assign(new THREE.Group().add(ring.mesh), { ring });
});
const flashes = pool(() => new THREE.Mesh(disc, fading(EMP_BLUE, FLASH_OPACITY)));
const cores = pool(() => new THREE.Mesh(disc, fading(0xffffff)));
const sparks = pool(() => new THREE.Mesh(quad, streak(EMP_BLUE)));
const bolts = pool(() => {
  const m = new THREE.Mesh(boltGeometry, fading(EMP_BLUE));
  m.add(new THREE.Mesh(boltHalo, shade(0x000000, 0.6)));
  return m;
});
const icons = skyIcons(EMP_OUTLINE);

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicNodeMaterial;

/** A bright thin segment from `a` to `b` on a unit quad, `px` wide on screen. */
function segment(m: THREE.Mesh, a: { x: number; y: number }, b: { x: number; y: number }, width: number, z: number) {
  m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, z);
  m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
  m.scale.set(Math.max(Math.hypot(b.x - a.x, b.y - a.y), 0.01), width * metresPerPx.value, 1);
}

/** Where `v`'s layer draws it: a helicopter in the air hangs at the Cruise Missile's altitude (layers/helicopter.ts climbs to it). */
const drawnAt = (v: VehicleView) => (v.kind === 'helicopter' && v.airborne ? lifted(v) : v);

/** `scale` is the chevron size in metres (constant on screen), for the marks and icons; `now` in ms runs the crackle. */
export function drawEmps(view: CommanderView, scale: number, now: number) {
  for (const d of empsInFlight(view.effects)) {
    const s = shadows.next();
    s.position.set(d.shadow.x, d.shadow.y, Z.shadow);
    s.rotation.z = d.shadow.rotation;
    s.scale.setScalar(d.size);
    const b = bodies.next();
    b.position.set(d.x, d.y, Z.body);
    b.rotation.z = d.rotation;
    b.scale.setScalar(d.size);
    b.frame.value = d.frame;
    const t = trails.next();
    segment(t, d.trail.tail, d.trail.head, TRAIL.px, Z.trail);
    material(t).opacity = TRAIL.opacity;
    const line = lines.next();
    segment(line, d, d.to, LINE.px, Z.line);
    material(line).color.setHex(sideColor(d.side));
    const mark = marks.next();
    mark.position.set(d.to.x, d.to.y, Z.marker);
    mark.scale.setScalar(scale);
    material(mark).color.setHex(sideColor(d.side));
    icons.place(d, d.to, d.heading, d.side, scale);
  }
  for (const e of view.effects ?? []) {
    if (e.asset !== 'emp') continue;
    const r = rings.next();
    r.position.set(e.x, e.y, Z.ring);
    r.ring.r.value = e.radius;
    // in the air, its target ring in its caller's colour, as the drone's; then its own, faint, while it holds
    r.ring.tint.value.setHex(e.burst === undefined ? sideColor(e.side ?? view.side) : EMP_BLUE);
    r.ring.alpha.value = e.burst === undefined ? AIM_RING_OPACITY : empRing(e.left);
    const flash = e.burst === undefined ? null : empFlash(e.burst, e.radius);
    if (!flash) continue;
    const f = flashes.next();
    f.position.set(e.x, e.y, Z.flash);
    f.scale.setScalar(Math.max(flash.r, 0.01));
    material(f).opacity = FLASH_OPACITY * flash.opacity;
    const c = cores.next();
    const up = burstAt(e);
    c.position.set(up.x, up.y, Z.core);
    c.scale.setScalar(scale * CORE_SCALE * flash.opacity);
    material(c).opacity = flash.opacity;
  }
  for (const v of view.vehicles ?? []) {
    if (!v.disabled) continue;
    const at = drawnAt(v);
    for (const spark of crackle(v.id, at, HULL_M[v.kind] ?? 10, now / 1000))
      for (let i = 1; i < spark.length; i++) segment(sparks.next(), spark[i - 1]!, spark[i]!, SPARK_PX, Z.spark);
    const bolt = bolts.next();
    bolt.position.set(at.x + scale * 0.9, at.y + scale * 0.9, Z.bolt); // by the icon's top right, clear of its body
    bolt.scale.setScalar(scale * 0.95);
  }
  for (const q of [shadows, bodies, trails, lines, marks, rings, flashes, cores, sparks, bolts, icons]) q.end();
}
