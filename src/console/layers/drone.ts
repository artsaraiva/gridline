// The Drone Strike on the map (#139), own ones and the enemy's (the sky rule): the baked drone at the nearest heading, lifted
// north-east of its ground shadow to the Cruise Missile's altitude, a thin short contrail along the path it flew, its
// bracketed tactical icon (edge-clamped while it is off screen, layers/sky-icon.ts), and its impact mark: a small square
// with a faint ring as wide as its blast suppresses. Shot down, it falls onto its shadow and fades, mark and icon gone. At
// the hit the shared impact (a smaller explosion and crater than a shell's) takes over. sprites/drone.ts says where everything is.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { metresPerPx, pool, sideColor } from '../renderer';
import { DRONE_OUTLINE, DRONE_SHADOW_FRAME, DRONE_SHEET, dronesInFlight } from '../sprites/drone';
import { spriteMesh } from '../sprites/sheet';
import { skyIcons } from './sky-icon';
import { dashedRing, fading, frameFill, frameOutline, merge, px, streak } from './symbols';

const Z = { shadow: 0.42, ring: 0.5, trail: 0.6, body: 0.72, marker: 0.9 };
const SHADOW_OPACITY = 0.42;
/** The contrail is this wide on screen and this strong: thinner and fainter than the missile's. */
const TRAIL = { px: 1.5, opacity: 0.45 };
const MARK_OPACITY = 0.9;
const RING_OPACITY = 0.35;

/** The impact mark, in chevrons: a small square outline round a solid one. */
const markGeometry = merge([frameOutline('friendly', 0.34, px(1.5)), frameFill('friendly', 0.12)]);
const quad = new THREE.PlaneGeometry(1, 1);

const shadows = pool(() => spriteMesh(DRONE_SHEET, { frame: DRONE_SHADOW_FRAME, shadow: true, opacity: SHADOW_OPACITY }));
const bodies = pool(() => spriteMesh(DRONE_SHEET));
const trails = pool(() => new THREE.Mesh(quad, streak()));
const marks = pool(() => new THREE.Mesh(markGeometry, fading(0xffffff, MARK_OPACITY)));
const rings = pool(() => {
  const ring = dashedRing(40, 0xffffff, { dash: 3, gap: 5, width: 1.5, opacity: RING_OPACITY }); // a quad big enough for its ring
  return Object.assign(new THREE.Group().add(ring.mesh), { ring });
});
const icons = skyIcons(DRONE_OUTLINE);

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicNodeMaterial;

/** `scale` is the chevron size in metres (constant on screen), for the mark and the icon. */
export function drawDrones(view: CommanderView, scale: number) {
  const radius = view.effects?.find((e) => e.asset === 'drone')?.radius ?? 0;
  for (const d of dronesInFlight(view.effects)) {
    const s = shadows.next();
    s.position.set(d.shadow.x, d.shadow.y, Z.shadow);
    s.rotation.z = d.shadow.rotation;
    s.scale.setScalar(d.size);
    s.material.opacity = SHADOW_OPACITY * d.opacity;
    const b = bodies.next();
    b.position.set(d.x, d.y, Z.body);
    b.rotation.z = d.rotation;
    b.scale.setScalar(d.size);
    b.frame.value = d.frame;
    b.material.opacity = d.opacity;

    const { tail, head } = d.trail;
    const t = trails.next();
    t.position.set((tail.x + head.x) / 2, (tail.y + head.y) / 2, Z.trail);
    t.rotation.z = d.heading;
    t.scale.set(Math.hypot(head.x - tail.x, head.y - tail.y), TRAIL.px * metresPerPx.value, 1);
    material(t).opacity = TRAIL.opacity * d.opacity;
    if (d.lost) continue;

    const mark = marks.next();
    mark.position.set(d.to.x, d.to.y, Z.marker);
    mark.scale.setScalar(scale);
    material(mark).color.setHex(sideColor(d.side));
    const r = rings.next();
    r.position.set(d.to.x, d.to.y, Z.ring);
    r.ring.r.value = radius;
    r.ring.tint.value.setHex(sideColor(d.side));
    icons.place(d, d.to, d.heading, d.side, scale);
  }
  for (const q of [shadows, bodies, trails, marks, rings, icons]) q.end();
}
