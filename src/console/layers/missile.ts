// The Cruise Missile on the map (#99): the baked missile at the nearest heading with its ground shadow and contrail
// (a streak that hangs and fades after the hit),
// a bright line from it to BF4's small diamond target mark in the caller's colour, and a bracketed tactical icon
// that sits on the missile on screen and, while the missile is off screen, is glued to the screen edge where the line
// leaves it with an arrow pointing out to the missile (under the chrome panels, as in BF4). At the hit everything goes and the shared impact (explosion, crater, plume) takes over.
// sprites/missile.ts says where everything is; edge-clamp.ts where the icon sits.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { edgeClamp } from '../edge-clamp';
import { metresPerPx, pool, sideColor, toScreen, toWorld } from '../renderer';
import { MISSILE_OUTLINE, MISSILE_SHADOW_FRAME, MISSILE_SHEET, missileInFlight, missiles, missileTrail } from '../sprites/missile';
import { spriteMesh } from '../sprites/sheet';
import { bar, brackets, fading, frameFill, frameOutline, px, streak } from './symbols';

const LINE_PX = 1.5;
const LINE_OPACITY = 0.85;
const TRAIL_PX = 2.5;
/** The contrail in flight; it fades from this after the hit. */
const TRAIL_OPACITY = 0.6;
/** The edge-clamped icon's centre keeps this far inside the screen. */
const EDGE_MARGIN_PX = 56;
/** Icon size in chevrons (its brackets span about 1.9 of these). */
const ICON_SCALE = 1.44;
/** The icon and its arrow are the caller's colour this far toward white: bright, as in BF4. */
const ICON_WHITEN = 0.55;
const WHITE = new THREE.Color(0xffffff);
const iconColor = new THREE.Color();
/** Edge arrow size in chevrons. */
const ARROW_SCALE = 1.6;
const Z = { shadow: 0.42, trail: 0.6, line: 0.56, body: 0.72, marker: 0.9, icon: 0.92 };
export const MARKER_OPACITY = 0.9;

const iconGeometry = new THREE.ShapeGeometry(new THREE.Shape(MISSILE_OUTLINE.map(([x, y]) => new THREE.Vector2(x, y))));
/** One non-indexed geometry from several pieces, for a mark drawn as a single mesh. */
function merge(pieces: THREE.BufferGeometry[]) {
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  for (const piece of pieces) positions.push(...(piece.toNonIndexed().getAttribute('position').array as Float32Array));
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return merged;
}
const bracketGeometry = brackets(px(1.6 / ICON_SCALE));
/** The edge arrow: a chevron pointing +x, set just outside the brackets toward the missile. */
const arrowGeometry = merge([bar(-0.14, 0.26, 0.1, 0, px(3 / ARROW_SCALE)), bar(0.1, 0, -0.14, -0.26, px(3 / ARROW_SCALE))]);
/** BF4's target mark, in chevrons: a diamond outline round a small solid diamond, with a tick out from each point. #101: the Gunship's focus too. */
export const markerGeometry = merge([
  frameOutline('hostile', 0.62, px(1.5)), // the 'hostile' frame is the diamond; only its shape is borrowed
  frameFill('hostile', 0.26),
  bar(0.71, 0, 0.98, 0, px(1.5)), bar(-0.71, 0, -0.98, 0, px(1.5)), bar(0, 0.71, 0, 0.98, px(1.5)), bar(0, -0.71, 0, -0.98, px(1.5)),
]);
const quad = new THREE.PlaneGeometry(1, 1);

const bodies = pool(() => spriteMesh(MISSILE_SHEET));
const shadows = pool(() => spriteMesh(MISSILE_SHEET, { frame: MISSILE_SHADOW_FRAME, shadow: true, opacity: 0.42 }));
const trails = pool(() => new THREE.Mesh(quad, streak()));
const lines = pool(() => new THREE.Mesh(quad, fading(0xffffff, LINE_OPACITY)));
const markers = pool(() => new THREE.Mesh(markerGeometry, fading(0xffffff, MARKER_OPACITY)));
const arrows = pool(() => new THREE.Mesh(arrowGeometry, fading(0xffffff)));
const icons = pool(() => {
  const icon = new THREE.Mesh(iconGeometry, fading(0xffffff));
  const corners = new THREE.Mesh(bracketGeometry, icon.material);
  return Object.assign(new THREE.Group().add(icon, corners), { icon });
});

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicNodeMaterial;

/** `scale` is the chevron size in metres (constant on screen), for the icon. */
export function drawMissiles(view: CommanderView, scale: number) {
  const flock = missiles(view);
  const box = { x0: EDGE_MARGIN_PX, y0: EDGE_MARGIN_PX, x1: innerWidth - EDGE_MARGIN_PX, y1: innerHeight - EDGE_MARGIN_PX };
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

    // The icon sits on the missile on screen; off screen it is glued to the edge where the line leaves the screen,
    // with an arrow out to the missile.
    const at = edgeClamp(toScreen(p), toScreen(p.to), box);
    const icon = icons.next();
    const w = at.clamped ? toWorld(at.x, at.y) : p;
    icon.position.set(w.x, w.y, Z.icon);
    icon.rotation.z = p.heading - Math.PI / 2;
    icon.scale.setScalar(scale * ICON_SCALE);
    iconColor.setHex(color).lerp(WHITE, ICON_WHITEN);
    material(icon.icon).color.copy(iconColor);
    if (at.clamped) {
      const out = Math.atan2(p.y - w.y, p.x - w.x);
      const arrow = arrows.next();
      const off = scale * ICON_SCALE * 1.45;
      arrow.position.set(w.x + Math.cos(out) * off, w.y + Math.sin(out) * off, Z.icon);
      arrow.rotation.z = out;
      arrow.scale.setScalar(scale * ARROW_SCALE);
      material(arrow).color.copy(iconColor);
    }
  }
  for (const q of [bodies, shadows, trails, lines, markers, icons, arrows]) q.end();
}
