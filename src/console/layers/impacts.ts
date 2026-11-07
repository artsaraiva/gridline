// Barrage impacts as baked sprites (#62): the explosion flipbook, then a smoke plume that drifts and fades, and a
// crater decal that stays for the match. Fed by `impact` events; the sim says where, `impactLook` says how it looks.
// Crater cap and smoke fade are Console constants in sprites.ts, not Simulation Tune values: they only change the
// look, and the Console has no Tune of its own.
import * as THREE from 'three/webgpu';
import { layer } from '../renderer';
import { type ImpactRecord, type ImpactSprite, impactLook, recordImpact, type SpriteSheetId, spriteMaterial } from '../sprites';

const quad = new THREE.PlaneGeometry(1, 1);

type Sprite = { mesh: THREE.Mesh; material: THREE.MeshBasicNodeMaterial; frame: ReturnType<typeof spriteMaterial>['frame'] };
const pools: Record<'crater' | 'explosion' | 'plume', Sprite[]> = { crater: [], explosion: [], plume: [] };
const SHEET: Record<keyof typeof pools, SpriteSheetId> = { crater: 'crater', explosion: 'explosion', plume: 'smoke-puff' };
const Z = { crater: 0.3, plume: 0.62, explosion: 0.66 };

const impacts: ImpactRecord[] = [];

export const resetImpacts = () => {
  impacts.length = 0;
  for (const pool of Object.values(pools)) pool.length = 0;
};

export const addImpact = (x: number, y: number, now: number) => recordImpact(impacts, x, y, now);
/** When the latest impact landed, in ms; -Infinity before the first. */
export const lastImpactAt = () => impacts.at(-1)?.at ?? -Infinity;

function place(kind: keyof typeof pools, i: number, s: ImpactSprite) {
  let p = pools[kind][i];
  if (!p) {
    const { material, frame } = spriteMaterial(SHEET[kind]);
    p = { mesh: new THREE.Mesh(quad, material), material, frame };
    layer.add(p.mesh);
    pools[kind].push(p);
  }
  p.mesh.visible = true;
  p.mesh.position.set(s.x, s.y, Z[kind]);
  // Mirror across the NE-SW diagonal (flip x, turn a quarter): keeps the baked north-east sun where it is.
  p.mesh.scale.set(s.flip ? -s.size : s.size, s.size, 1);
  p.mesh.rotation.z = s.flip ? -Math.PI / 2 : 0;
  p.material.opacity = s.opacity;
  p.frame.value = s.frame;
}

export function drawImpacts(now: number) {
  const n = { crater: 0, explosion: 0, plume: 0 };
  for (const i of impacts) {
    const look = impactLook(i, now);
    place('crater', n.crater++, look.crater);
    if (look.explosion) place('explosion', n.explosion++, look.explosion);
    for (const p of look.plume) if (p.opacity > 0) place('plume', n.plume++, p);
  }
  for (const kind of ['crater', 'explosion', 'plume'] as const) {
    for (let i = n[kind]; i < pools[kind].length; i++) pools[kind][i]!.mesh.visible = false;
  }
}
