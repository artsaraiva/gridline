// The bracketed tactical icon of a thing in the sky (#139: the Drone Strike's drone, the Recon Plane), as the Cruise
// Missile's (#99): in its caller's colour toward white, at constant screen size, on the aircraft while it is on screen and
// glued to the screen edge toward it while it is not, with an arrow out to it. Names no Asset: each layer passes its outline.
import * as THREE from 'three/webgpu';
import type { SideId, Vec2 } from '../../sim/types';
import { edgeClamp } from '../edge-clamp';
import { pool, sideColor, toScreen, toWorld } from '../renderer';
import { bar, brackets, fading, merge, px, shade } from './symbols';

/** Icon size in chevrons (its brackets span about 1.9 of these), as the missile's. */
const ICON_SCALE = 1.44;
const ICON_WHITEN = 0.55;
const ARROW_SCALE = 1.6;
/** The edge-clamped icon's centre keeps this far inside the screen, as the missile's. */
const EDGE_MARGIN_PX = 56;
const Z = 0.93;
const WHITE = new THREE.Color(0xffffff);
const color = new THREE.Color();
const bracketGeometry = brackets(px(1.6 / ICON_SCALE));
const arrowGeometry = merge([bar(-0.14, 0.26, 0.1, 0, px(3 / ARROW_SCALE)), bar(0.1, 0, -0.14, -0.26, px(3 / ARROW_SCALE))]);
const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicNodeMaterial;

/** Pooled icons of one `outline` (symbol units, nose +y). */
export function skyIcons(outline: [number, number][]) {
  const iconGeometry = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))));
  const haloGeometry = iconGeometry.clone().scale(1.12, 1.1, 1).translate(0, 0, -0.01);
  const icons = pool(() => {
    const icon = new THREE.Mesh(iconGeometry, fading(0xffffff));
    icon.add(new THREE.Mesh(haloGeometry, shade(0x000000, 0.45)));
    return Object.assign(new THREE.Group().add(icon, new THREE.Mesh(bracketGeometry, icon.material)), { icon });
  });
  const arrows = pool(() => new THREE.Mesh(arrowGeometry, fading(0xffffff)));
  return {
    /** The icon of `side`'s aircraft drawn at `p`, heading `heading`; off screen it sits where the line from `toward` to it leaves the screen. `scale` is the chevron size in metres. */
    place(p: Vec2, toward: Vec2, heading: number, side: SideId, scale: number) {
      color.setHex(sideColor(side)).lerp(WHITE, ICON_WHITEN);
      const at = edgeClamp(toScreen(p), toScreen(toward), { x0: EDGE_MARGIN_PX, y0: EDGE_MARGIN_PX, x1: innerWidth - EDGE_MARGIN_PX, y1: innerHeight - EDGE_MARGIN_PX });
      const w = at.clamped ? toWorld(at.x, at.y) : p;
      const icon = icons.next();
      icon.position.set(w.x, w.y, Z);
      icon.rotation.z = heading - Math.PI / 2;
      icon.scale.setScalar(scale * ICON_SCALE);
      material(icon.icon).color.copy(color);
      if (!at.clamped) return;
      const out = Math.atan2(p.y - w.y, p.x - w.x);
      const off = scale * ICON_SCALE * 1.45;
      const arrow = arrows.next();
      arrow.position.set(w.x + Math.cos(out) * off, w.y + Math.sin(out) * off, Z);
      arrow.rotation.z = out;
      arrow.scale.setScalar(scale * ARROW_SCALE);
      material(arrow).color.copy(color);
    },
    end() {
      icons.end();
      arrows.end();
    },
  };
}
