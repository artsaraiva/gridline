// Barrage impacts as 2D marks: a flash, smoke fading over SMOKE_MS and a crater that stays for the match. Past
// MAX_CRATERS the oldest is removed. Fed by `impact` events; the sim says where, this says how long.
// shortcut: durations and the cap are constants here, not Tune (the Console has no Tune); move them when one is wanted.
import * as THREE from 'three/webgpu';
import { flat, layer } from '../renderer';

const FLASH_MS = 250;
const SMOKE_MS = 20000;
const MAX_CRATERS = 60;
const disc = new THREE.CircleGeometry(1, 32);

interface Impact {
  at: number;
  crater: THREE.Mesh;
  smoke: THREE.Mesh;
  flash: THREE.Mesh;
}
const impacts: Impact[] = [];

export const resetImpacts = () => (impacts.length = 0);

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicMaterial;

export function addImpact(x: number, y: number, now: number) {
  const mark = (color: number, z: number, radius: number) => {
    const m = new THREE.Mesh(disc, flat(color));
    material(m).transparent = true;
    m.position.set(x, y, z);
    m.scale.setScalar(radius);
    layer.add(m);
    return m;
  };
  impacts.push({ at: now, crater: mark(0x120f0b, 0.3, 3.2), smoke: mark(0x8a8678, 0.6, 4), flash: mark(0xfff0c0, 0.7, 7) });
  if (impacts.length > MAX_CRATERS) {
    const old = impacts.shift()!;
    for (const m of [old.crater, old.smoke, old.flash]) {
      layer.remove(m);
      material(m).dispose();
    }
  }
}

export function drawImpacts(now: number) {
  for (const i of impacts) {
    const age = now - i.at;
    material(i.crater).opacity = 0.75;
    i.flash.visible = age < FLASH_MS;
    material(i.flash).opacity = 1 - age / FLASH_MS;
    i.smoke.visible = age < SMOKE_MS;
    material(i.smoke).opacity = 0.5 * Math.max(0, 1 - age / SMOKE_MS);
    i.smoke.scale.setScalar(4 + 6 * Math.min(1, age / 4000)); // puffs out, then thins
  }
}
