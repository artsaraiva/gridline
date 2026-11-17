// Combat as 2D marks: per shot, a round that flies from shooter to target (a white-hot core in a soft tint of its Side) and
// what it kicks up where it lands: dust on a miss, sparks on a hit, now and then a ricochet. Nothing is drawn at a
// Soldier's or a machine gun's muzzle: the shooter's chevron pulses as it fires (layers/chevrons.ts), and that is mark
// enough; only a heavy gun flashes (the AA's twin barrels). tracer-look.ts says how each ages and how a round follows who
// fired it and with which gun: a helicopter's miniguns a rope of fine rounds, a jet's cannon small bursts, an AA's flak.
// Only shots the Console may show arrive here (the Simulation's fog filter drops unseen enemy shooters); a shot whose
// target is out of sight draws nothing. A miss lands a few metres off. #110: an end on a jet or helicopter in the air
// sits on its sprite, lifted north-east of the ground (the AA's fire is a stream of these, one a tick).
import * as THREE from 'three/webgpu';
import type { CommanderView, SideId, SimEvent, Vec2 } from '../../sim/types';
import { pool } from '../renderer';
import { session } from '../session';
import { WIND } from '../sprites/impact';
import { aloft } from '../sprites/missile';
import { soft, streak, UNIT_PX } from './symbols';
import { burstAt, flightMs, type Kick, KICK_MS, landing, MUZZLE_MS, puffAt, ROPE_GAP_MS, ROPE_SCATTER_M, type Round, roundAt, roundLength, roundOf, sparkAt, TWIN_M, VAPOUR_MS } from './tracer-look';

const MISS_M = 2.5;
const TINT = { friendly: 0xc8f0ff, hostile: 0xffbe96 };
/** The round's core and its tint, in screen px wide; the streak is never shorter than this many px, so it reads zoomed out. */
const CORE_PX = 1.5;
const TINT_PX = 4.5;
const MIN_ROUND_PX = 16;
const Z = { puff: 1.1, round: 1.15 };

const quad = new THREE.PlaneGeometry(1, 1);
const cores = pool(() => new THREE.Mesh(quad, streak(0xffffff)));
const tints = pool(() => new THREE.Mesh(quad, streak(TINT.friendly)));
const puffs = pool(() => new THREE.Mesh(quad, soft(0xc4baa6, { glow: false })));
const sparks = pool(() => new THREE.Mesh(quad, streak(0xffe6a0)));
const flashes = pool(() => new THREE.Mesh(quad, soft(0xfff0d0)));
const flak = pool(() => new THREE.Mesh(quad, soft(0x3a3e40, { dark: true })));
const vapours = pool(() => new THREE.Mesh(quad, streak(0xe2e8e8)));

/** `p` as drawn: lifted as the sprite of something in the air. */
const up = (p: Vec2, air: boolean | undefined) => (air ? aloft(p) : p);

interface Shot {
  from: Vec2;
  to: Vec2;
  at: number;
  side: 'friendly' | 'hostile';
  hit: boolean;
  /** Its round, by who fired it and with what. */
  round: Round;
  /** Its target is in the air: a flak round bursts there. */
  aloft: boolean;
}
let shots: Shot[] = [];
let kicks: Kick[] = [];
/** Sniper rounds' vapour threads and heavy guns' muzzle flashes, each from its time `at`. */
let vapour: { from: Vec2; to: Vec2; at: number; opacity: number }[] = [];
let muzzles: (Vec2 & { at: number })[] = [];
/** Twin guns fire their barrels in turn: the shots each shooter has fired. */
const fired = new Map<number, number>();

export const resetTracers = () => {
  shots = [];
  kicks = [];
  vapour = [];
  muzzles = [];
  fired.clear();
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
  if (!target) return;
  const round = roundOf(ride?.kind ?? 'foot', e.gun);
  const aloft = 'airborne' in hit! && !!hit!.airborne;
  const start = { x: from.x, y: from.y };
  if (round.twin) {
    // the barrels in turn, each a little off the line to the target, with a flash at the muzzle
    const n = fired.get(e.from) ?? 0;
    fired.set(e.from, n + 1);
    const d = Math.hypot(target.x - from.x, target.y - from.y) || 1;
    const s = n % 2 ? TWIN_M : -TWIN_M;
    Object.assign(start, { x: from.x - ((target.y - from.y) / d) * s + ((target.x - from.x) / d) * 4, y: from.y + ((target.x - from.x) / d) * s + ((target.y - from.y) / d) * 4 });
    muzzles.push({ ...start, at: now });
  }
  for (let i = 0; i < (round.rope ?? 1); i++) {
    const off = i ? ROPE_SCATTER_M : e.hit ? 0 : MISS_M; // a rope's other rounds land round the one the Simulation fired
    const to = { x: target.x + (Math.random() - 0.5) * 2 * off, y: target.y + (Math.random() - 0.5) * 2 * off };
    shots.push({ from: start, to, at: now + i * ROPE_GAP_MS, side: side(e.side), hit: !i && !!e.hit, round, aloft });
  }
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
    if (age < 0) return true; // a rope's later round, not fired yet
    const { size, mps } = s.round;
    const round = roundAt(s.from, s.to, age, Math.max(roundLength(s.round), MIN_ROUND_PX * size * mpp), mps);
    if (round) {
      const tint = tints.next();
      span(tint, round.tail, round.head, TINT_PX * size * mpp, Z.round);
      material(tint).color.setHex(TINT[s.side]);
      material(tint).opacity = 0.5;
      span(cores.next(), round.tail, round.head, CORE_PX * size * mpp, Z.round + 0.01);
      return true;
    }
    if (age >= flightMs(s.from, s.to, mps)) {
      kicks.push(...landing(s.to, Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x), s.hit, now, Math.random, s.round, s.aloft));
      if (s.round.vapour) vapour.push({ from: s.from, to: s.to, at: now, opacity: s.round.vapour });
    }
    return false;
  });
  kicks = kicks.filter((k) => {
    const age = now - k.at;
    if (age >= KICK_MS[k.kind]) return false;
    if (k.kind === 'burst' || k.kind === 'flak') {
      const look = burstAt(k, age)!;
      const p = (k.kind === 'burst' ? flashes : flak).next();
      const s = k.kind === 'flak' ? age / 1000 : 0;
      p.position.set(k.x + WIND.x * s * 3, k.y + WIND.y * s * 3, Z.puff);
      p.scale.setScalar(2 * Math.max(look.radius, 2 * mpp));
      material(p).opacity = look.opacity;
      return true;
    }
    if (k.kind === 'dust') {
      const look = puffAt(age, k.scale)!;
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
  vapour = vapour.filter((v) => {
    const life = (now - v.at) / VAPOUR_MS;
    if (life >= 1) return false;
    const m = vapours.next();
    span(m, v.from, v.to, 1 * mpp, Z.puff);
    material(m).opacity = v.opacity * (1 - life);
    return true;
  });
  muzzles = muzzles.filter((f) => {
    const life = (now - f.at) / MUZZLE_MS;
    if (life >= 1) return false;
    const m = flashes.next();
    m.position.set(f.x, f.y, Z.round);
    m.scale.setScalar(Math.max(3.5, 9 * mpp));
    material(m).opacity = 0.9 * (1 - life);
    return true;
  });
  for (const p of [cores, tints, puffs, sparks, flashes, flak, vapours]) p.end();
}
