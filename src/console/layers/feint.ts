// The Feint (#143): the baked dummy paratrooper under its canopy with its ground shadow while it falls, then spread-eagled on the
// ground with its canopy collapsed beside it; a filled tactical icon (a figure under a canopy) beside it at constant screen size,
// in its Side's colour; and, on its own Console only, a faint ring pulsing out from it at each burst of its firecrackers. The enemy's
// dummy shows only while it falls or one of its own Soldiers sees it (the view says so), with no pulse: nothing shows which enemies
// it fools. sprites/feint.ts says where it is.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { pool, sideColor } from '../renderer';
import { FEINT_CANOPY, FEINT_FIGURE, FEINT_HEAD, FEINT_LINES, FEINT_SHADOW_FRAME, FEINT_SHEET, feintDrop, feintPulse } from '../sprites/feint';
import { spriteMesh } from '../sprites/sheet';
import { bar, dashedRing, fading, merge, shade } from './symbols';

const Z = { pulse: 0.5, shadow: 0.43, body: 0.45, falling: 0.75, icon: 0.92 };
/** At its brightest the pulse is this strong: faint, as the spec has it. */
const PULSE_OPACITY = 0.6;
const shape = (pts: [number, number][]) => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
const iconGeometry = merge([
  shape(FEINT_CANOPY),
  shape(FEINT_FIGURE),
  new THREE.CircleGeometry(FEINT_HEAD.r, 16).translate(FEINT_HEAD.x, FEINT_HEAD.y, 0),
  ...FEINT_LINES.map(([x0, y0, x1, y1]) => bar(x0, y0, x1, y1, 0.045)),
]);
const haloGeometry = iconGeometry.clone().scale(1.18, 1.14, 1).translate(0, 0, -0.02);

const dummies = pool(() => {
  const shadow = spriteMesh(FEINT_SHEET, { frame: FEINT_SHADOW_FRAME, shadow: true });
  const body = spriteMesh(FEINT_SHEET);
  const icon = new THREE.Mesh(iconGeometry, fading(0xffffff));
  icon.add(new THREE.Mesh(haloGeometry, shade(0x000000, 0.75)));
  const pulse = dashedRing(40, 0xffffff, { dash: 1, gap: 0, width: 1.5, opacity: PULSE_OPACITY }); // gap 0: a solid line
  return Object.assign(new THREE.Group().add(shadow, body, icon, pulse.mesh), { shadow, body, icon, pulse });
});

/** `scale` is the chevron size in metres (constant on screen), for the icon. */
export function drawFeints(view: CommanderView, scale: number) {
  for (const e of view.effects ?? []) {
    if (e.asset !== 'feint' || e.landsIn === undefined || !e.fall) continue;
    const d = feintDrop({ x: e.x, y: e.y, landsIn: e.landsIn, fall: e.fall });
    const color = sideColor(e.side ?? view.side);
    const m = dummies.next();
    m.shadow.visible = !d.landed;
    m.shadow.position.set(d.shadow.x, d.shadow.y, Z.shadow);
    m.shadow.scale.setScalar(d.shadow.size);
    m.shadow.material.opacity = d.shadow.opacity;
    m.body.position.set(d.x, d.y, d.landed ? Z.body : Z.falling);
    m.body.scale.setScalar(d.size);
    m.body.frame.value = d.frame;
    // constant screen size, south-east of the dummy: clear of its canopy (north-east of it in the air, west of it on the ground) and of its shadow (south-west)
    m.icon.position.set(d.crate.x + d.size * 0.1 + scale * 0.9, d.crate.y - d.size * 0.1 - scale * 0.9, Z.icon);
    m.icon.scale.setScalar(scale * 1.3);
    m.icon.material.color.setHex(color);
    const p = feintPulse(e.burst);
    m.pulse.mesh.visible = !!p;
    m.pulse.mesh.position.set(e.x, e.y, Z.pulse);
    if (p) {
      m.pulse.r.value = Math.max(p.r, 0.01);
      m.pulse.alpha.value = PULSE_OPACITY * p.opacity;
      m.pulse.tint.value.setHex(color);
    }
  }
  dummies.end();
}
