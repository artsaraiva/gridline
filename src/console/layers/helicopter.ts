// Transport helicopters on the map (#109): own ones, enemy ones in sight or in the air (the same sprite in its Faction's
// paint) and Wrecks; the baked body at the nearest heading with its rotor, lifted north-east of its ground shadow while it
// flies (the Cruise Missile's treatment) and flat on the ground once landed, climbing and settling between the two; with
// anyone aboard the blades turn, faint, over the light haze of their disc (drawn here: a baked translucent haze loads
// premultiplied and reads near black on the map). Over
// each live one BF4's helicopter icon at constant screen size (a solid fuselage, tail boom and tail bar in the role colour
// under the crossed rotor), coloured as the tank's (sprites/vehicle-icon.ts).
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { BRIGHT, COLOR, pool } from '../renderer';
import { session } from '../session';
import { targeting } from '../targeting';
import { spriteMesh } from '../sprites/sheet';
import { HELI_SHEET, HELI_WORLD_M, climb, helicopterPose } from '../sprites/helicopter';
import { CRUISE_ALTITUDE_M } from '../sprites/missile';
import { iconDim, vehicleIcon } from '../sprites/vehicle-icon';
import { bar, merge, px, shade } from './symbols';

// Above the ground vehicles; in the air, above the missile's shadow and under its body
const Z = { wreck: 0.44, shadow: 0.43, body: 0.5, air: 0.7, icon: 0.94 }; // the rotor 0.01 over the body
const SHADOW_OPACITY = 0.5;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6, selected: COLOR.amber };

// BF4's helicopter icon, in chevrons, nose +y, about 12 x 17 px: a rounded fuselage, the tail boom with its tail bar, and the
// main rotor as two long crossed blades over it. `g` grows it for the dark halo.
const [HW, HH, CY] = [0.24, 0.36, 0.14]; // fuselage half width, half length, centre
const [BOOM, TAIL_Y, TAIL_W] = [px(2.2), -0.72, 0.3];
const [BLADE, BLADE_R] = [px(1.6), 0.62];
function shape(g = 0) {
  const s = new THREE.Shape();
  s.absellipse(0, CY, HW + g / 2, HH + g / 2, 0, 2 * Math.PI, false, 0);
  const boom = bar(0, CY - HH + 0.05, 0, TAIL_Y, BOOM + g);
  const tail = bar(-TAIL_W / 2 - g / 2, TAIL_Y, TAIL_W / 2 + g / 2, TAIL_Y, px(2) + g);
  const r = BLADE_R * Math.SQRT1_2 + g / 2;
  const blades = [bar(-r, CY - r, r, CY + r, BLADE + g), bar(-r, CY + r, r, CY - r, BLADE + g)];
  return merge([new THREE.ShapeGeometry(s, 16), boom, tail, ...blades]);
}
const HALO = px(2.5);
/** The rotor disc, as a fraction of the frame (7 m of the 18 m frame), and how it reads while spinning. */
const DISC_R = 7 / HELI_WORLD_M;
const [DISC_COLOR, DISC_OPACITY, BLADES_SPINNING] = [0xd8dee2, 0.16, 0.45];

function haze() {
  const material = new THREE.MeshBasicNodeMaterial({ color: DISC_COLOR, opacity: DISC_OPACITY, transparent: true, depthWrite: false });
  material.opacityNode = BRIGHT;
  return new THREE.Mesh(new THREE.CircleGeometry(DISC_R, 48), material);
}

const shadows = pool(() => spriteMesh(HELI_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const parts = pool(() => spriteMesh(HELI_SHEET)); // body and rotor from one pool, as the tank's hull and turret (a second pool on this sheet drew nothing in review)
const discs = pool(haze);
const icons = pool(() => {
  const m = new THREE.Mesh(shape(), shade(COLOR.friendly, 1));
  m.add(new THREE.Mesh(shape(HALO), shade(0x000000, 0.45)).translateZ(-0.01));
  return m;
});

/** Each live helicopter's altitude on screen, by id, and when it was last drawn. */
const altitudes = new Map<number, number>();
let last = -1;

/** `scale` is the chevron size in metres (constant on screen), for the icon; `now` in milliseconds. */
export function drawHelicopters(view: CommanderView, scale: number, now: number) {
  const dt = last < 0 ? 0 : Math.min(0.25, (now - last) / 1000);
  last = now;
  const selected = view.friendlies.filter((f) => f.squad === targeting.selected).map((f) => f.id);
  const seen = new Set<number>();
  for (const v of view.vehicles ?? []) {
    if (v.kind !== 'helicopter') continue;
    seen.add(v.id);
    const altitude = v.wreck ? 0 : climb(altitudes.get(v.id) ?? (v.airborne ? CRUISE_ALTITUDE_M : 0), !!v.airborne, dt);
    if (!v.wreck) altitudes.set(v.id, altitude);
    const p = helicopterPose(v, altitude, now / 1000);
    const up = altitude > 0;
    const s = shadows.next();
    s.position.set(p.shadow.x, p.shadow.y, Z.shadow);
    s.rotation.z = p.shadow.rotation;
    s.scale.setScalar(p.size);
    s.frame.value = p.shadow.frame;
    const b = parts.next();
    b.position.set(p.x, p.y, v.wreck ? Z.wreck : up ? Z.air : Z.body);
    b.rotation.z = p.body.rotation;
    b.scale.setScalar(p.size);
    b.frame.value = p.body.frame;
    b.material.opacity = 1;
    if (p.rotor) {
      const z = (up ? Z.air : Z.body) + 0.01;
      if (p.rotor.spinning) {
        const d = discs.next();
        d.position.set(p.x, p.y, z);
        d.scale.setScalar(p.size);
      }
      const r = parts.next();
      r.position.set(p.x, p.y, z + 0.005);
      r.rotation.z = p.rotor.rotation;
      r.scale.setScalar(p.size);
      r.frame.value = p.rotor.frame;
      r.material.opacity = p.rotor.spinning ? BLADES_SPINNING : 1;
    }
    const role = vehicleIcon(v, session.commanderSide, selected);
    if (role) {
      const icon = icons.next();
      icon.position.set(p.x, p.y, Z.icon);
      icon.scale.setScalar(scale);
      icon.rotation.z = Math.atan2(v.fy, v.fx) - Math.PI / 2;
      icon.material.color.setHex(ICON_COLOR[role]).multiplyScalar(iconDim(v)); // #143: dimmed while an EMP holds it
    }
  }
  for (const id of altitudes.keys()) if (!seen.has(id)) altitudes.delete(id);
  shadows.end();
  parts.end();
  discs.end();
  icons.end();
}
