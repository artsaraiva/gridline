// Gunships on the map (#101): own ones and the enemy's (the sky rule), and Wrecks. In the air the baked body at the nearest
// heading, lifted north-east of its ground shadow to the Cruise Missile's altitude and banked into its turns; its
// bracketed tactical icon in the caller's colour over it at constant screen size, glued to the screen edge toward it while it
// is off screen, with an arrow out to it (#99); its shells arcing down from the aircraft, each the Barrage's round and streak,
// the shared impact taking over where they land. A Wreck lies flat where it fell. The focus ring is layers/effects.ts'.
// sprites/gunship.ts says where everything is.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { edgeClamp } from '../edge-clamp';
import { metresPerPx, pool, sideColor, toScreen, toWorld } from '../renderer';
import { GUNSHIP_OUTLINE, GUNSHIP_SHEET, gunshipPose, gunshipShell, gunshipsInAir } from '../sprites/gunship';
import { spriteMesh } from '../sprites/sheet';
import { SHELL_SHEET } from '../sprites/shell';
import { bar, brackets, fading, merge, px, shade, streak } from './symbols';

// In the air over the jet's body (it flies its pass lower); its Wreck on the ground with the others
const Z = { wreck: 0.44, shadow: 0.43, streak: 0.6, shell: 0.72, body: 0.76, icon: 0.94 };
const SHADOW_OPACITY = 0.42;
/** Icon size in chevrons (its brackets span about 1.9 of these), as the missile's. */
const ICON_SCALE = 1.44;
/** The icon and its arrow are the caller's colour this far toward white, as the missile's. */
const ICON_WHITEN = 0.55;
const ARROW_SCALE = 1.6;
/** The edge-clamped icon's centre keeps this far inside the screen, as the missile's. */
const EDGE_MARGIN_PX = 56;
/** A shell's streak is this wide on screen, as the Barrage's. */
const STREAK_PX = 2.5;

const iconGeometry = new THREE.ShapeGeometry(new THREE.Shape(GUNSHIP_OUTLINE.map(([x, y]) => new THREE.Vector2(x, y))));
const haloGeometry = iconGeometry.clone().scale(1.12, 1.1, 1).translate(0, 0, -0.01);
const bracketGeometry = brackets(px(1.6 / ICON_SCALE));
const arrowGeometry = merge([bar(-0.14, 0.26, 0.1, 0, px(3 / ARROW_SCALE)), bar(0.1, 0, -0.14, -0.26, px(3 / ARROW_SCALE))]);
const quad = new THREE.PlaneGeometry(1, 1);
const WHITE = new THREE.Color(0xffffff);
const iconColor = new THREE.Color();

const shadows = pool(() => spriteMesh(GUNSHIP_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const bodies = pool(() => {
  const b = spriteMesh(GUNSHIP_SHEET);
  b.material.side = THREE.DoubleSide; // a right turn is drawn flipped (sprites/gunship.ts)
  return b;
});
const shells = pool(() => spriteMesh(SHELL_SHEET));
const streaks = pool(() => new THREE.Mesh(quad, streak()));
const icons = pool(() => {
  const icon = new THREE.Mesh(iconGeometry, fading(0xffffff));
  icon.add(new THREE.Mesh(haloGeometry, shade(0x000000, 0.45)));
  const corners = new THREE.Mesh(bracketGeometry, icon.material);
  return Object.assign(new THREE.Group().add(icon, corners), { icon });
});
const arrows = pool(() => new THREE.Mesh(arrowGeometry, fading(0xffffff)));

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicNodeMaterial;

/** `scale` is the chevron size in metres (constant on screen), for the icon. */
export function drawGunships(view: CommanderView, scale: number) {
  const box = { x0: EDGE_MARGIN_PX, y0: EDGE_MARGIN_PX, x1: innerWidth - EDGE_MARGIN_PX, y1: innerHeight - EDGE_MARGIN_PX };
  for (const w of view.vehicles ?? []) {
    if (w.kind !== 'gunship' || !w.wreck) continue; // in the air it is drawn from its Asset below
    const p = gunshipPose({ side: w.side, craft: w, wreck: true });
    const b = bodies.next();
    b.position.set(p.x, p.y, Z.wreck);
    b.rotation.z = p.body.rotation;
    b.scale.set(p.size, p.size, 1);
    b.frame.value = p.body.frame;
  }
  for (const e of view.effects ?? []) {
    if (e.asset !== 'gunship') continue;
    for (const s of e.shells ?? []) {
      const r = gunshipShell(s.from!, s, s.flight);
      const t = streaks.next();
      const [dx, dy] = [r.x - r.tail.x, r.y - r.tail.y];
      t.position.set((r.x + r.tail.x) / 2, (r.y + r.tail.y) / 2, Z.streak);
      t.rotation.z = Math.atan2(dy, dx);
      t.scale.set(Math.hypot(dx, dy), STREAK_PX * metresPerPx.value, 1);
      const m = shells.next();
      m.position.set(r.x, r.y, Z.shell);
      m.rotation.z = r.rotation;
      m.scale.setScalar(r.size);
      m.frame.value = r.frame;
    }
  }
  for (const g of gunshipsInAir(view.effects)) {
    const p = gunshipPose(g);
    const s = shadows.next();
    s.position.set(p.shadow.x, p.shadow.y, Z.shadow);
    s.rotation.z = p.shadow.rotation;
    s.scale.setScalar(p.size);
    s.frame.value = p.shadow.frame;
    const b = bodies.next();
    b.position.set(p.x, p.y, Z.body);
    b.rotation.z = p.body.rotation;
    b.scale.set(p.body.mirror ? -p.size : p.size, p.size, 1);
    b.frame.value = p.body.frame;

    // The icon sits on the aircraft on screen; off screen it is glued to the edge where the line from its focus leaves the screen
    iconColor.setHex(sideColor(g.side)).lerp(WHITE, ICON_WHITEN);
    const at = edgeClamp(toScreen(p), toScreen(g.e), box);
    const w = at.clamped ? toWorld(at.x, at.y) : p;
    const icon = icons.next();
    icon.position.set(w.x, w.y, Z.icon);
    icon.rotation.z = p.heading - Math.PI / 2;
    icon.scale.setScalar(scale * ICON_SCALE);
    material(icon.icon).color.copy(iconColor);
    if (at.clamped) {
      const out = Math.atan2(p.y - w.y, p.x - w.x);
      const off = scale * ICON_SCALE * 1.45;
      const arrow = arrows.next();
      arrow.position.set(w.x + Math.cos(out) * off, w.y + Math.sin(out) * off, Z.icon);
      arrow.rotation.z = out;
      arrow.scale.setScalar(scale * ARROW_SCALE);
      material(arrow).color.copy(iconColor);
    }
  }
  for (const q of [shadows, bodies, shells, streaks, icons, arrows]) q.end();
}
