// Barrage impacts as baked sprites (#62): the explosion flipbook, then a smoke plume that drifts and fades, and a
// crater decal that stays for the match. Fed by `impact` events; the sim says where, sprites/impact.ts says how it looks.
import { pool } from '../renderer';
import { CRATER_SHEET, EXPLOSION_SHEET, type ImpactRecord, type ImpactSprite, impactLook, recordImpact } from '../sprites/impact';
import { spriteMesh } from '../sprites/sheet';
import { SMOKE_PUFF_SHEET } from '../sprites/smoke-puff';

const pools = { crater: pool(() => spriteMesh(CRATER_SHEET)), explosion: pool(() => spriteMesh(EXPLOSION_SHEET)), plume: pool(() => spriteMesh(SMOKE_PUFF_SHEET)) };
const Z = { crater: 0.3, plume: 0.62, explosion: 0.66 };

const impacts: ImpactRecord[] = [];

export const resetImpacts = () => {
  impacts.length = 0;
};

export const addImpact = (x: number, y: number, now: number) => recordImpact(impacts, x, y, now);
/** When the latest impact landed, in ms; -Infinity before the first. */
export const lastImpactAt = () => impacts.at(-1)?.at ?? -Infinity;
/** The impacts of the last `ms` ms, oldest first. */
export const recentImpacts = (now: number, ms: number) => impacts.filter((i) => now - i.at < ms);

function place(kind: keyof typeof pools, s: ImpactSprite) {
  const p = pools[kind].next();
  p.position.set(s.x, s.y, Z[kind]);
  // Mirror across the NE-SW diagonal (flip x, turn a quarter): keeps the baked north-east sun where it is.
  p.scale.set(s.flip ? -s.size : s.size, s.size, 1);
  p.rotation.z = s.flip ? -Math.PI / 2 : 0;
  p.material.opacity = s.opacity;
  p.frame.value = s.frame;
}

export function drawImpacts(now: number) {
  for (const i of impacts) {
    const look = impactLook(i, now);
    place('crater', look.crater);
    if (look.explosion) place('explosion', look.explosion);
    for (const p of look.plume) if (p.opacity > 0) place('plume', p);
  }
  for (const p of Object.values(pools)) p.end();
}
