// Each HQ's artillery battery: four guns in a row behind the HQ, where its Side's shells come from. It is drawn flat (pits,
// barrels: no baked sprite yet), and each shell that leaves fires the next gun in turn: its muzzle blast (sprites/muzzle.ts)
// and the barrel thrown back. layers/battery.ts draws it.
// Console look only: the Simulation's shells still leave from the HQ; the guns are where the Console shows that happening.
import type { MapData, SideId, Vec2 } from '../../sim/types';

export const BATTERY_GUNS = 4;
/** The row stands this far behind the HQ's centre, away from the enemy, its guns this far apart. */
const BACK_M = 30;
const SPACING_M = 9;
/** A gun: its pit's width, its barrel's length and width, in metres. */
export const GUN = { pit: 8, barrel: 6.5, width: 0.9, breech: 2 };
const RECOIL_M = 1.6;

export interface Battery extends Vec2 {
  /** The unit vector from the battery to the enemy's HQ: the way its guns point at rest. */
  fx: number;
  fy: number;
  guns: Vec2[];
}

export function batteryOf(map: MapData, side: SideId): Battery {
  const hq = map.hqs[side];
  const enemy = map.hqs[side === 'nato' ? 'pact' : 'nato'];
  const d = Math.hypot(enemy.x - hq.x, enemy.y - hq.y) || 1;
  const [fx, fy] = [(enemy.x - hq.x) / d, (enemy.y - hq.y) / d];
  const [x, y] = [hq.x - fx * BACK_M, hq.y - fy * BACK_M];
  const guns = Array.from({ length: BATTERY_GUNS }, (_, i) => ({ x: x - fy * (i - (BATTERY_GUNS - 1) / 2) * SPACING_M, y: y + fx * (i - (BATTERY_GUNS - 1) / 2) * SPACING_M }));
  return { x, y, fx, fy, guns };
}

/** How far back along its bearing a gun's barrel sits `age` ms after its shot: thrown back, then run out again. */
export const recoil = (age: number) => (age < 0 ? 0 : RECOIL_M * Math.exp((-5 * age) / 1000));
