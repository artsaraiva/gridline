// The Cruise Missile on the map (#99): the baked missile at the nearest heading with its ground shadow and contrail
// (a streak that hangs and fades after the hit),
// a line from it to a small square impact marker in the caller's colour with a faint zone ring, and a bracketed
// tactical icon that rides the missile on screen and clamps to the screen edge where the line leaves it while the
// missile is off screen. At the hit everything goes and the shared impact (explosion, crater, plume) takes over.
// sprites/missile.ts says where everything is; edge-clamp.ts where the icon sits.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { edgeClamp, type Inset } from '../edge-clamp';
import { metresPerPx, pool, sideColor, toScreen, toWorld } from '../renderer';
import { MISSILE_SHADOW_FRAME, MISSILE_SHEET, missileInFlight, missiles, missileTrail } from '../sprites/missile';
import { spriteMesh } from '../sprites/sheet';
import { bar, dashedRing, fading, frameOutline, px, shade, streak } from './symbols';

const LINE_PX = 1.5;
const TRAIL_PX = 2.5;
/** The contrail in flight; it fades from this after the hit. */
const TRAIL_OPACITY = 0.6;
/** The edge-clamped icon keeps this far inside the screen. */
const EDGE_MARGIN_PX = 30;
const Z = { shadow: 0.42, trail: 0.6, line: 0.56, ring: 0.5, body: 0.72, marker: 0.9, icon: 0.92 };

// Tactical missile symbol: a slim body with pop-out wings and a tail, pointing +y, in symbol units.
const iconShape = new THREE.Shape(
  [
    [0, 0.62], [0.09, 0.42], [0.09, 0.1], [0.5, 0.02], [0.5, -0.08], [0.09, -0.08], [0.09, -0.4], [0.3, -0.5], [0.3, -0.6],
    [-0.3, -0.6], [-0.3, -0.5], [-0.09, -0.4], [-0.09, -0.08], [-0.5, -0.08], [-0.5, 0.02], [-0.09, 0.1], [-0.09, 0.42],
  ].map(([x, y]) => new THREE.Vector2(x, y)),
);
const iconGeometry = new THREE.ShapeGeometry(iconShape);
const haloGeometry = iconGeometry.clone().scale(1.25, 1.2, 1).translate(0, 0, -0.02);
/** Four corner brackets round the icon. */
const bracketGeometry = (() => {
  const g: THREE.BufferGeometry[] = [];
  const r = 0.95;
  const l = 0.32;
  const w = px(1.6);
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    g.push(bar(sx! * r, sy! * r, sx! * (r - l), sy! * r, w), bar(sx! * r, sy! * r, sx! * r, sy! * (r - l), w));
  }
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (const piece of g) positions.push(...(piece.toNonIndexed().getAttribute('position').array as Float32Array));
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return merged;
})();
const markerGeometry = frameOutline('friendly', 0.3, px(1.5));
const quad = new THREE.PlaneGeometry(1, 1);

const bodies = pool(() => spriteMesh(MISSILE_SHEET));
const shadows = pool(() => spriteMesh(MISSILE_SHEET, { frame: MISSILE_SHADOW_FRAME, shadow: true, opacity: 0.42 }));
const trails = pool(() => new THREE.Mesh(quad, streak()));
const lines = pool(() => new THREE.Mesh(quad, fading(0xffffff, 0.55)));
const markers = pool(() => new THREE.Mesh(markerGeometry, fading(0xffffff)));
const rings = pool(() => {
  const ring = dashedRing(35, 0xffffff, { dash: 2, gap: 6, width: 1.5, opacity: 0.35 });
  return Object.assign(ring.mesh, { ring });
});
const icons = pool(() => {
  const icon = new THREE.Mesh(iconGeometry, fading(0xffffff));
  icon.add(new THREE.Mesh(haloGeometry, shade(0x000000, 0.75)));
  const brackets = new THREE.Mesh(bracketGeometry, icon.material);
  return Object.assign(new THREE.Group().add(icon, brackets), { icon });
});

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicNodeMaterial;

/** Where an edge-clamped mark may sit: inside the margins and clear of the chrome panels docked at the sides. */
function inset(): Inset {
  const r: Inset = { x0: EDGE_MARGIN_PX, y0: EDGE_MARGIN_PX, x1: innerWidth - EDGE_MARGIN_PX, y1: innerHeight - EDGE_MARGIN_PX };
  for (const el of document.querySelectorAll('[data-hit]')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0) continue;
    if (b.left < EDGE_MARGIN_PX) r.x0 = Math.max(r.x0, b.right + EDGE_MARGIN_PX);
    else if (b.right > innerWidth - EDGE_MARGIN_PX) r.x1 = Math.min(r.x1, b.left - EDGE_MARGIN_PX);
  }
  return r;
}

/** `scale` is the chevron size in metres (constant on screen), for the marker and the icon. */
export function drawMissiles(view: CommanderView, scale: number) {
  const flock = missiles(view);
  const box = flock.some((e) => e.flight < 1) ? inset() : null;
  for (const e of flock) {
    const color = sideColor(e.side);
    const p = missileInFlight(e);

    const t = missileTrail(p, e.left);
    const trail = trails.next();
    trail.position.set((t.tail.x + t.head.x) / 2, (t.tail.y + t.head.y) / 2, Z.trail);
    trail.rotation.z = t.angle;
    trail.scale.set(t.length, TRAIL_PX * metresPerPx.value, 1);
    material(trail).opacity = TRAIL_OPACITY * t.opacity;
    if (p.flight >= 1) continue; // after the hit only the contrail hangs; the impact layer has the rest

    const s = shadows.next();
    s.position.set(p.shadow.x, p.shadow.y, Z.shadow);
    s.rotation.z = p.shadow.rotation;
    s.scale.setScalar(p.size);
    const b = bodies.next();
    b.position.set(p.x, p.y, Z.body);
    b.rotation.z = p.bodyRotation;
    b.scale.setScalar(p.size);
    b.frame.value = p.frame;

    const line = lines.next();
    const lx = p.to.x - p.x;
    const ly = p.to.y - p.y;
    line.position.set((p.x + p.to.x) / 2, (p.y + p.to.y) / 2, Z.line);
    line.rotation.z = Math.atan2(ly, lx);
    line.scale.set(Math.hypot(lx, ly), LINE_PX * metresPerPx.value, 1);
    material(line).color.setHex(color);

    const marker = markers.next();
    marker.position.set(p.to.x, p.to.y, Z.marker);
    marker.scale.setScalar(scale);
    material(marker).color.setHex(color);
    const ring = rings.next();
    ring.position.set(p.to.x, p.to.y, Z.ring);
    ring.ring.r.value = e.radius;
    ring.ring.tint.value.setHex(color);

    // The icon rides beside the missile on screen; off screen it clamps to the edge where the line leaves the screen.
    const at = edgeClamp(toScreen(p), toScreen(p.to), box!);
    const icon = icons.next();
    if (at.clamped) {
      const w = toWorld(at.x, at.y);
      icon.position.set(w.x, w.y, Z.icon);
    } else {
      const off = Math.max(scale * 1.3, p.size * 0.8);
      icon.position.set(p.x + Math.sin(p.heading) * off, p.y - Math.cos(p.heading) * off, Z.icon);
    }
    icon.rotation.z = p.heading - Math.PI / 2;
    icon.scale.setScalar(scale * 1.1);
    material(icon.icon).color.setHex(color);
  }
  for (const q of [bodies, shadows, trails, lines, markers, icons]) q.end();
  rings.end();
}
