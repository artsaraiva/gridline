// Combat as 2D marks: per shot, a faint tracer streaking from shooter to target (~150 ms) and a muzzle-flash dot.
// Only shots the Console may show arrive here (the Simulation's fog filter drops unseen enemy shooters); a shot whose
// target is out of sight gets the flash only. A miss lands a few metres off.
import * as THREE from 'three/webgpu';
import type { CommanderView, SideId, SimEvent, Vec2 } from '../../sim/types';
import { BRIGHT, GLOW, layer } from '../renderer';
import { session } from '../session';
import { fading, px } from './symbols';

const TRACER_MS = 150;
const STREAK_MS = 60; // time for the streak's head to reach the target
const FLASH_MS = 60;
const MISS_M = 2.5;
const TINT = { friendly: 0xc8f0ff, hostile: 0xffbe96 };
const flashGeometry = new THREE.CircleGeometry(px(2.2), 10);

type Shot = { line: THREE.Line; flash: THREE.Mesh; from: Vec2; to: Vec2 | null; at: number };
const pool: Shot[] = [];
let live = 0;

export const resetTracers = () => {
  pool.length = 0;
  live = 0;
};

function lineMaterial() {
  const material = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.opacityNode = BRIGHT;
  material.mrtNode = GLOW();
  return material;
}

/** Adds the marks for a `shot` or `suppressive` event, placed from the view's Soldiers. */
export function addShot(e: Extract<SimEvent, { kind: 'shot' | 'suppressive' }>, view: CommanderView, now: number) {
  const at = (id: number) => view.friendlies.find((s) => s.id === id) ?? view.contacts.find((s) => s.id === id);
  const from = at(e.from);
  if (!from) return;
  const target = e.kind === 'shot' ? at(e.to) : e;
  const off = e.hit ? 0 : MISS_M;
  const to = target ? { x: target.x + (Math.random() - 0.5) * 2 * off, y: target.y + (Math.random() - 0.5) * 2 * off } : null;
  let shot = pool[live];
  if (!shot) {
    const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(6, 3)), lineMaterial());
    const flash = new THREE.Mesh(flashGeometry, fading(0xffe6a0, 0.9));
    layer.add(line, flash);
    pool.push((shot = { line, flash, from, to, at: now }));
  }
  Object.assign(shot, { from: { x: from.x, y: from.y }, to, at: now });
  (shot.line.material as THREE.LineBasicNodeMaterial).color.setHex(TINT[side(e.side)]);
  live++;
}

const side = (s: SideId) => (s === session.commanderSide ? 'friendly' : 'hostile');

/** `scale` is the symbol unit in metres. */
export function drawTracers(now: number, scale: number) {
  for (let i = live - 1; i >= 0; i--) {
    const shot = pool[i]!;
    const age = now - shot.at;
    if (age > TRACER_MS) {
      shot.line.visible = shot.flash.visible = false;
      pool[i] = pool[--live]!; // keep the live ones at the front
      pool[live] = shot;
      continue;
    }
    shot.flash.visible = age < FLASH_MS;
    shot.flash.position.set(shot.from.x, shot.from.y, 1.2);
    shot.flash.scale.setScalar(scale);
    shot.line.visible = !!shot.to;
    if (!shot.to) continue;
    const f = Math.min(1, age / STREAK_MS);
    const along = (k: number) => [shot.from.x + (shot.to!.x - shot.from.x) * k, shot.from.y + (shot.to!.y - shot.from.y) * k, 1.15];
    const position = shot.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    position.set([...along(Math.max(0, f - 0.5)), ...along(f)]);
    position.needsUpdate = true;
    shot.line.geometry.computeBoundingSphere();
    (shot.line.material as THREE.LineBasicNodeMaterial).opacity = 0.75 * (1 - age / TRACER_MS);
  }
}
