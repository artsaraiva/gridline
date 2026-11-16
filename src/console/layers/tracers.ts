// Combat as 2D marks: per shot, a round that flies from shooter to target (a white-hot core in a soft tint of its Side), a
// two-frame muzzle flash that lights the ground under it, and what the round kicks up where it lands: dust on a miss,
// sparks on a hit, now and then a ricochet, and a wisp of smoke at the muzzle. tracer-look.ts says how each ages.
// Only shots the Console may show arrive here (the Simulation's fog filter drops unseen enemy shooters); a shot whose
// target is out of sight gets the flash only. A miss lands a few metres off. #110: an end on a jet or helicopter in the air
// sits on its sprite, lifted north-east of the ground (the AA's fire is a stream of these, one a tick).
import * as THREE from 'three/webgpu';
import type { CommanderView, SideId, SimEvent, Vec2 } from '../../sim/types';
import { pool } from '../renderer';
import { session } from '../session';
import { WIND } from '../sprites/impact';
import { aloft } from '../sprites/missile';
import { bar, fading, merge, px, soft, streak, UNIT_PX } from './symbols';
import { flashAt, flightMs, type Kick, KICK_MS, landing, puffAt, roundAt, ROUND_LENGTH_M, sparkAt } from './tracer-look';

const MISS_M = 2.5;
const TINT = { friendly: 0xc8f0ff, hostile: 0xffbe96 };
const FLASH = 0xffe6a0;
/** The round's core and its tint, in screen px wide; the streak is never shorter than this many px, so it reads zoomed out. */
const CORE_PX = 1.5;
const TINT_PX = 4.5;
const MIN_ROUND_PX = 16;
/** The light a flash throws on the ground, in px across at its brightest, and how opaque. */
const LIGHT_PX = 52;
const LIGHT_OPACITY = 0.32;
/** The muzzle sits this many symbol units ahead of the shooter's icon. */
const MUZZLE = 0.8;
/** One shot in four leaves a wisp at the muzzle. */
const WISP_CHANCE = 0.25;
const Z = { puff: 1.1, light: 1.12, round: 1.15, flash: 1.2 };

const quad = new THREE.PlaneGeometry(1, 1);
/** The flash in symbol units, pointing +x from the muzzle: a cone with a spike out to each side. */
const flashGeometry = merge([
  new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(px(8), -px(5)), new THREE.Vector2(px(17), 0), new THREE.Vector2(px(8), px(5))])),
  bar(0, 0, px(3), px(8), px(1.2)),
  bar(0, 0, px(3), -px(8), px(1.2)),
]);

const cores = pool(() => new THREE.Mesh(quad, streak(0xffffff)));
const tints = pool(() => new THREE.Mesh(quad, streak(TINT.friendly)));
const flashes = pool(() => new THREE.Mesh(flashGeometry, fading(FLASH)));
const lights = pool(() => new THREE.Mesh(quad, soft(0xffd696)));
const puffs = pool(() => new THREE.Mesh(quad, soft(0xc4baa6, { glow: false })));
const sparks = pool(() => new THREE.Mesh(quad, streak(FLASH)));

/** `p` as drawn: lifted as the sprite of something in the air. */
const up = (p: Vec2, air: boolean | undefined) => (air ? aloft(p) : p);

interface Shot {
  from: Vec2;
  to: Vec2 | null;
  at: number;
  side: 'friendly' | 'hostile';
  hit: boolean;
  /** The flash is turned this far off the line of fire, so no two look stamped. */
  jitter: number;
  landed: boolean;
}
let shots: Shot[] = [];
let kicks: Kick[] = [];

export const resetTracers = () => {
  shots = [];
  kicks = [];
};

/** Adds the marks for a `shot` or `suppressive` event, placed from the view's Soldiers. */
export function addShot(e: Extract<SimEvent, { kind: 'shot' | 'suppressive' }>, view: CommanderView, now: number) {
  const at = (id: number) => view.friendlies.find((s) => s.id === id) ?? view.contacts.find((s) => s.id === id) ?? view.vehicles?.find((v) => v.id === id); // #107: a rocket's target
  const shooter = at(e.from);
  if (!shooter) return;
  const ride = 'vehicle' in shooter ? view.vehicles?.find((v) => v.id === shooter.vehicle) : undefined;
  const from = up(shooter, ride?.airborne);
  const hit = e.kind === 'shot' ? at(e.to) : e;
  const target = hit && up(hit, 'airborne' in hit && hit.airborne);
  const off = e.hit ? 0 : MISS_M;
  const to = target ? { x: target.x + (Math.random() - 0.5) * 2 * off, y: target.y + (Math.random() - 0.5) * 2 * off } : null;
  shots.push({ from: { x: from.x, y: from.y }, to, at: now, side: side(e.side), hit: !!e.hit, jitter: (Math.random() - 0.5) * 0.3, landed: false });
  if (Math.random() < WISP_CHANCE) kicks.push({ kind: 'wisp', x: from.x, y: from.y, at: now, angle: 0, speed: 0 });
}

const side = (s: SideId) => (s === session.commanderSide ? 'friendly' : 'hostile');

/** Lays a unit quad from `a` to `b`, `width` metres wide, its uv.x running tail to head. */
function span(mesh: THREE.Mesh, a: Vec2, b: Vec2, width: number, z: number) {
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, z);
  mesh.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
  mesh.scale.set(Math.max(1e-3, Math.hypot(b.x - a.x, b.y - a.y)), width, 1);
}
const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicNodeMaterial;

/** `scale` is the symbol unit in metres. */
export function drawTracers(now: number, scale: number) {
  const mpp = scale / UNIT_PX; // metres per screen px
  shots = shots.filter((s) => {
    const age = now - s.at;
    const heading = s.to ? Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x) : 0;
    const flash = flashAt(age);
    if (flash) {
      // at the muzzle, ahead of the shooter's icon, so the flash never hides who fired
      const muzzle = s.to ? { x: s.from.x + Math.cos(heading) * scale * MUZZLE, y: s.from.y + Math.sin(heading) * scale * MUZZLE } : s.from;
      if (s.to) {
        const f = flashes.next();
        f.position.set(muzzle.x, muzzle.y, Z.flash);
        f.rotation.z = heading + s.jitter;
        f.scale.setScalar(scale * flash.size);
      }
      const l = lights.next();
      l.position.set(muzzle.x, muzzle.y, Z.light);
      l.scale.setScalar(LIGHT_PX * mpp);
      material(l).opacity = LIGHT_OPACITY * flash.light;
    }
    const round = s.to && roundAt(s.from, s.to, age, Math.max(ROUND_LENGTH_M, MIN_ROUND_PX * mpp));
    if (round) {
      const tint = tints.next();
      span(tint, round.tail, round.head, TINT_PX * mpp, Z.round);
      material(tint).color.setHex(TINT[s.side]);
      material(tint).opacity = 0.5;
      span(cores.next(), round.tail, round.head, CORE_PX * mpp, Z.round + 0.01);
    }
    if (s.to && !s.landed && age >= flightMs(s.from, s.to)) {
      s.landed = true;
      kicks.push(...landing(s.to, heading, s.hit, now, Math.random));
    }
    return !!flash || !!round;
  });
  kicks = kicks.filter((k) => {
    const age = now - k.at;
    if (age >= KICK_MS[k.kind]) return false;
    if (k.kind === 'dust' || k.kind === 'wisp') {
      const look = puffAt(k.kind, age)!;
      const p = puffs.next();
      const s = age / 1000;
      p.position.set(k.x + WIND.x * s * 3, k.y + WIND.y * s * 3, Z.puff);
      p.scale.setScalar(2 * Math.max(look.radius, 3 * mpp));
      material(p).opacity = look.opacity;
      return true;
    }
    const look = sparkAt(k, age)!;
    const at = (m: number) => ({ x: k.x + Math.cos(k.angle) * m, y: k.y + Math.sin(k.angle) * m });
    const spark = sparks.next();
    span(spark, at(look.tail), at(look.head), 1.2 * mpp, Z.round);
    material(spark).opacity = look.opacity;
    return true;
  });
  for (const p of [cores, tints, flashes, lights, puffs, sparks]) p.end();
}
