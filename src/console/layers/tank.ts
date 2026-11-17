// Tanks on the map (#107): own tanks, enemy tanks in sight (the same sprite in its Faction's paint) and Wrecks; the baked hull
// at the nearest heading with the turret laid on its target over it, each with its ground shadow. Over each live tank BF4's
// tactical tank icon at constant screen size (hull outline, turret and gun turning with the sprite's), in its Side's colour,
// grey-white while nobody is aboard, amber while the selected Squad has anyone aboard. The main gun fires with a muzzle blast
// (layers/muzzle.ts) and the hull rocks back; its round is a hot point with a glow at the head of a short bright streak, a long
// faint wake behind it that hangs a moment after it lands. sprites/tank.ts says how.
import * as THREE from 'three/webgpu';
import type { CommanderView } from '../../sim/types';
import { COLOR, metresPerPx, pool } from '../renderer';
import { session } from '../session';
import { targeting } from '../targeting';
import { spriteMesh } from '../sprites/sheet';
import { drawnAt, turned, turretOf } from '../sprites/destruction';
import { muzzleOf, rock, roundStreak, TANK_SHEET, tankPose, WAKE_M, WAKE_MS } from '../sprites/tank';
import { iconDim, vehicleIcon } from '../sprites/vehicle-icon';
import { deathFor } from './destruction';
import { addMuzzle } from './muzzle';
import { bar, fading, merge, px, shade, soft, streak } from './symbols';

const Z = { wreck: 0.44, shadow: 0.42, hull: 0.46, turret: 0.47, round: 0.6, icon: 0.93 };
const SHADOW_OPACITY = 0.5;
/** Icon size in chevrons: BF4's tank icon stands just taller than a Soldier's. */
const ICON_SCALE = 1.15;
const ROUND_PX = 2.4;
const WAKE_PX = 1.5;
/** A main gun's blast next to a battery gun's. */
const BLAST = 0.7;
const ICON_COLOR = { friendly: COLOR.friendly, hostile: COLOR.hostile, empty: 0xd4d8d6, selected: COLOR.amber };

// BF4's tank icon, in chevrons, nose +y, a little taller than a Soldier's chevron; `g` grows a piece for its dark halo.
// The hull: a bold frame open at the front where the gun leaves it, its back bar a touch wider (the track ends). Over it the
// turret: a solid dome-topped block, the gun reaching past the hull's front.
const W = 0.15; // stroke
const hull = (g = 0) =>
  merge([
    bar(-0.31, -0.4, -0.31, 0.34 + W / 2, W + g), // left side
    bar(0.31, -0.4, 0.31, 0.34 + W / 2, W + g), // right side
    bar(-0.4, -0.42, 0.4, -0.42, W + 0.02 + g), // back, past the sides
    bar(-0.31 - W / 2, 0.34, -0.15, 0.34, W + g), // front, either side of the gun
    bar(0.15, 0.34, 0.31 + W / 2, 0.34, W + g),
  ]);
function turret(g = 0) {
  const [hw, y0, y1] = [0.15 + g / 2, -0.27 - g / 2, 0.02];
  const dome = new THREE.Shape();
  dome.moveTo(-hw, y0);
  dome.lineTo(hw, y0);
  dome.lineTo(hw, y1);
  dome.quadraticCurveTo(hw, y1 + hw * 1.1, 0, y1 + hw * 1.1);
  dome.quadraticCurveTo(-hw, y1 + hw * 1.1, -hw, y1);
  dome.closePath();
  return merge([new THREE.ShapeGeometry(dome, 6), bar(0, 0.1, 0, 0.66 + g / 2, 0.09 + g)]);
}
const HALO = px(2.5);

const shadows = pool(() => spriteMesh(TANK_SHEET, { shadow: true, opacity: SHADOW_OPACITY }));
const parts = pool(() => spriteMesh(TANK_SHEET));
const icons = pool(() => {
  const frame = new THREE.Mesh(hull(), fading(COLOR.friendly));
  frame.add(new THREE.Mesh(hull(HALO), shade(0x000000, 0.45)).translateZ(-0.01));
  const top = new THREE.Mesh(turret(), fading(COLOR.friendly));
  top.add(new THREE.Mesh(turret(HALO), shade(0x000000, 0.45)).translateZ(-0.005));
  top.position.z = 0.01;
  return Object.assign(new THREE.Group().add(frame, top), { hull: frame, turret: top });
});
const rounds = pool(() => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), streak(0xffffff)));
const wakes = pool(() => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), streak(0xffe2be)));
const heats = pool(() => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), soft(0xffc878)));

/** The rounds in the air last frame, by where they left and land; each tank's last shot (ms), for its recoil; and the wakes of rounds that have landed. */
let flying = new Map<string, { from: { x: number; y: number }; to: { x: number; y: number } }>();
const shotAt = new Map<number, { at: number; heading: number }>();
let landed: { from: { x: number; y: number }; to: { x: number; y: number }; at: number }[] = [];

export const resetTanks = () => {
  flying = new Map();
  shotAt.clear();
  landed = [];
};

/** `scale` is the chevron size in metres (constant on screen), for the icon; `now` in milliseconds, for a Wreck's thrown turret. */
export function drawTanks(view: CommanderView, scale: number, now: number) {
  const selected = view.friendlies.filter((f) => f.squad === targeting.selected).map((f) => f.id);
  const air = new Map<string, { from: { x: number; y: number }; to: { x: number; y: number } }>();
  for (const v of view.vehicles ?? []) {
    if (v.kind !== 'tank') continue; // #108: layers/jeep.ts draws jeeps
    for (const r of v.rounds ?? []) {
      // a round new to the air is a shot: the muzzle blast, and the hull rocks back
      const key = `${r.from.x}:${r.from.y}:${r.to.x}:${r.to.y}`;
      air.set(key, r);
      if (flying.has(key)) continue;
      const m = muzzleOf(r);
      shotAt.set(v.id, { at: now, heading: m.heading });
      addMuzzle({ ...m, at: now, power: BLAST });
    }
    const death = v.wreck ? deathFor(v) : undefined;
    const thrown = death ? turretOf(death, now) : null; // a Wreck's turret, blown off its hull (sprites/destruction.ts)
    const [tx, ty] = thrown ? turned(v.tx, v.ty, thrown.turn) : [v.tx, v.ty];
    const p = tankPose({ ...v, tx, ty });
    const shot = v.wreck ? undefined : shotAt.get(v.id);
    const back = shot ? rock(now - shot.at) : 0;
    if (shot) Object.assign(p, { x: p.x - Math.cos(shot.heading) * back, y: p.y - Math.sin(shot.heading) * back });
    const off = thrown ? drawnAt(thrown) : { x: 0, y: 0 };
    [p.shadow.hull, p.shadow.turret].forEach((s, i) => {
      const m = shadows.next();
      m.position.set(p.x + (i && thrown ? thrown.dx : 0), p.y + (i && thrown ? thrown.dy : 0), Z.shadow);
      m.rotation.z = s.rotation;
      m.scale.setScalar(p.size);
      m.frame.value = s.frame;
    });
    [p.hull, p.turret].forEach((s, i) => {
      const m = parts.next();
      m.position.set(p.x + (i ? off.x : 0), p.y + (i ? off.y : 0), v.wreck ? Z.wreck + i * 0.005 : i ? Z.turret : Z.hull);
      m.rotation.z = s.rotation;
      m.scale.setScalar(p.size * (i && thrown ? 1 + thrown.up / 25 : 1));
      m.frame.value = s.frame;
    });
    const role = vehicleIcon(v, session.commanderSide, selected);
    if (role) {
      const icon = icons.next();
      icon.position.set(p.x, p.y, Z.icon);
      icon.scale.setScalar(scale * ICON_SCALE);
      icon.hull.rotation.z = Math.atan2(v.fy, v.fx) - Math.PI / 2;
      icon.turret.rotation.z = Math.atan2(v.ty, v.tx) - Math.PI / 2;
      for (const part of [icon.hull, icon.turret]) part.material.color.setHex(ICON_COLOR[role]).multiplyScalar(iconDim(v)); // #143: dimmed while an EMP holds it
    }
    for (const r of v.rounds ?? []) {
      // a hot point with its glow, at the head of a short bright streak and a long faint wake
      const s = roundStreak(r);
      const m = rounds.next();
      m.position.set(s.x, s.y, Z.round);
      m.rotation.z = s.angle;
      m.scale.set(Math.max(s.length, 0.01), ROUND_PX * metresPerPx.value, 1);
      const w = roundStreak(r, WAKE_M);
      const wake = wakes.next();
      wake.position.set(w.x, w.y, Z.round - 0.01);
      wake.rotation.z = w.angle;
      wake.scale.set(Math.max(w.length, 0.01), WAKE_PX * metresPerPx.value, 1);
      wake.material.opacity = 0.3;
      const heat = heats.next();
      heat.position.set(s.head.x, s.head.y, Z.round + 0.01);
      heat.scale.setScalar(Math.max(4, 10 * metresPerPx.value));
      heat.material.opacity = 0.7;
    }
  }
  for (const [key, r] of flying) if (!air.has(key)) landed.push({ ...r, at: now }); // it has landed: its wake hangs a moment
  flying = air;
  landed = landed.filter((l) => now - l.at < WAKE_MS);
  for (const l of landed) {
    const w = roundStreak({ ...l, flight: 1 }, WAKE_M);
    const wake = wakes.next();
    wake.position.set(w.x, w.y, Z.round - 0.01);
    wake.rotation.z = w.angle;
    wake.scale.set(Math.max(w.length, 0.01), WAKE_PX * metresPerPx.value, 1);
    wake.material.opacity = 0.3 * (1 - (now - l.at) / WAKE_MS);
  }
  shadows.end();
  parts.end();
  icons.end();
  rounds.end();
  wakes.end();
  heats.end();
}
