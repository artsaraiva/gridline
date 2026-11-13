// The Redeploy Beacon (#142): the baked case under its canopy with its ground shadow while falling, then the landed case with
// its mast; once down, the lamp on the mast blinks in the Faction colour, and a filled tactical beacon icon sits beside it at
// constant screen size. While a living enemy stands inside the 30 m deny ring (own Console only) the ring shows, thin and faint
// in the hostile colour; none otherwise. The enemy's beacon shows only while one of its own Soldiers sees it (the view says so).
// sprites/beacon.ts says where it is.
import * as THREE from 'three/webgpu';
import { DEFAULT_TUNE } from '../../sim/tune';
import type { CommanderView } from '../../sim/types';
import { COLOR, pool, sideColor } from '../renderer';
import { BEACON_SHADOW_FRAME, BEACON_SHEET, beaconDrop, beaconLamp } from '../sprites/beacon';
import { spriteMesh } from '../sprites/sheet';
import { dashedRing, fading, merge, shade } from './symbols';

/** An annular sector about (cx, cy), `r0` to `r1` across, from angle `a0` to `a1`: one filled signal arc. */
function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const n = 8;
  const pts = [...Array(n + 1).keys()].map((i) => a0 + ((a1 - a0) * i) / n);
  const ring = [...pts.map((a) => new THREE.Vector2(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a))), ...pts.reverse().map((a) => new THREE.Vector2(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)))];
  return new THREE.ShapeGeometry(new THREE.Shape(ring));
}
const rect = (x0: number, y0: number, x1: number, y1: number) => new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]));
const LAMP = { x: 0, y: 0.24 };
// Tactical beacon symbol, filled: a case, its mast, the lamp on top and a signal arc either side of it.
const iconGeometry = merge([
  rect(-0.3, -0.62, 0.3, -0.36),
  rect(-0.05, -0.36, 0.05, LAMP.y),
  new THREE.CircleGeometry(0.12, 20).translate(LAMP.x, LAMP.y, 0),
  arc(LAMP.x, LAMP.y, 0.22, 0.31, -0.7, 0.7),
  arc(LAMP.x, LAMP.y, 0.22, 0.31, Math.PI - 0.7, Math.PI + 0.7),
]);
const haloGeometry = iconGeometry.clone().scale(1.25, 1.2, 1).translate(0, 0.01, -0.02);
const disc = new THREE.CircleGeometry(1, 24);
/** The lamp's glow, in chevron units: a bright core and a faint wide halo, so it reads at any zoom. */
const GLOW_CORE = 0.3;
const GLOW_HALO = 0.95;

const beacons = pool(() => {
  const shadow = spriteMesh(BEACON_SHEET, { frame: BEACON_SHADOW_FRAME, shadow: true });
  const body = spriteMesh(BEACON_SHEET);
  const icon = new THREE.Mesh(iconGeometry, fading(COLOR.friendly));
  icon.add(new THREE.Mesh(haloGeometry, shade(0x000000, 0.75)));
  const core = new THREE.Mesh(disc, fading(COLOR.friendly));
  const halo = new THREE.Mesh(disc, fading(COLOR.friendly));
  const deny = dashedRing(DEFAULT_TUNE.beaconDenyM, COLOR.hostile, { dash: 1, gap: 0, width: 1, opacity: 0.5 }); // gap 0: a solid line
  return Object.assign(new THREE.Group().add(shadow, body, icon, core, halo, deny.mesh), { shadow, body, icon, core, halo, deny });
});

const tint = (m: THREE.Mesh, color: number, opacity?: number) => {
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.color.setHex(color);
  if (opacity !== undefined) mat.opacity = opacity;
};

/** `scale` is the chevron size in metres (constant on screen), used for the icon and the lamp's glow; `now` in ms runs the blink. */
export function drawBeacons(view: CommanderView, scale: number, now: number) {
  for (const e of view.effects ?? []) {
    if (e.asset !== 'beacon' || e.landsIn === undefined || !e.fall) continue;
    const d = beaconDrop({ x: e.x, y: e.y, landsIn: e.landsIn, fall: e.fall });
    const color = sideColor(e.side ?? view.side);
    const m = beacons.next();
    m.shadow.visible = !d.landed;
    m.shadow.position.set(d.shadow.x, d.shadow.y, 0.43);
    m.shadow.scale.setScalar(d.shadow.size);
    m.shadow.material.opacity = d.shadow.opacity;
    m.body.position.set(d.x, d.y, d.landed ? 0.45 : 0.75);
    m.body.scale.setScalar(d.size);
    m.body.frame.value = d.frame;
    // Constant screen size, south-east of the case: clear of the canopy (north-east of it in the air, north-west on the ground) and of the mast's shadow (south-west).
    m.icon.position.set(d.crate.x + d.size * 0.1 + scale * 0.9, d.crate.y - d.size * 0.1 - scale * 0.9, 0.92);
    m.icon.scale.setScalar(scale * 1.3);
    tint(m.icon, color);
    const lamp = beaconLamp(e, now / 1000);
    m.core.visible = m.halo.visible = d.landed && lamp.on > 0; // it lights up once it is down
    m.core.position.set(lamp.x, lamp.y, 0.9);
    m.core.scale.setScalar(scale * GLOW_CORE);
    tint(m.core, color, lamp.on);
    m.halo.position.set(lamp.x, lamp.y, 0.89);
    m.halo.scale.setScalar(scale * GLOW_HALO);
    tint(m.halo, color, lamp.on * 0.35);
    m.deny.mesh.visible = !!e.contested;
    m.deny.mesh.position.set(e.x, e.y, 0.5);
    m.deny.r.value = e.radius;
  }
  beacons.end();
}
