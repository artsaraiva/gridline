// #124: where a helicopter sets down and the dogleg it flies there and home. Pure choices from the Match RNG; no trig at run time
// (the Simulation's determinism rule): a bearing is one of 72 unit vectors, 5 degrees apart, written out below.
import type { Match } from './index';
import { between, rnd } from './rng';
import { dist2, insidePolygon } from './geometry';
import { nearestWalkable } from './grid';
import type { Vec2 } from './types';

const BEARINGS: [number, number][] = [
  [1, 0], [0.996195, 0.087156], [0.984808, 0.173648], [0.965926, 0.258819], [0.939693, 0.34202], [0.906308, 0.422618],
  [0.866025, 0.5], [0.819152, 0.573576], [0.766044, 0.642788], [0.707107, 0.707107], [0.642788, 0.766044], [0.573576, 0.819152],
  [0.5, 0.866025], [0.422618, 0.906308], [0.34202, 0.939693], [0.258819, 0.965926], [0.173648, 0.984808], [0.087156, 0.996195],
  [0, 1], [-0.087156, 0.996195], [-0.173648, 0.984808], [-0.258819, 0.965926], [-0.34202, 0.939693], [-0.422618, 0.906308],
  [-0.5, 0.866025], [-0.573576, 0.819152], [-0.642788, 0.766044], [-0.707107, 0.707107], [-0.766044, 0.642788], [-0.819152, 0.573576],
  [-0.866025, 0.5], [-0.906308, 0.422618], [-0.939693, 0.34202], [-0.965926, 0.258819], [-0.984808, 0.173648], [-0.996195, 0.087156],
  [-1, 0], [-0.996195, -0.087156], [-0.984808, -0.173648], [-0.965926, -0.258819], [-0.939693, -0.34202], [-0.906308, -0.422618],
  [-0.866025, -0.5], [-0.819152, -0.573576], [-0.766044, -0.642788], [-0.707107, -0.707107], [-0.642788, -0.766044], [-0.573576, -0.819152],
  [-0.5, -0.866025], [-0.422618, -0.906308], [-0.34202, -0.939693], [-0.258819, -0.965926], [-0.173648, -0.984808], [-0.087156, -0.996195],
  [0, -1], [0.087156, -0.996195], [0.173648, -0.984808], [0.258819, -0.965926], [0.34202, -0.939693], [0.422618, -0.906308],
  [0.5, -0.866025], [0.573576, -0.819152], [0.642788, -0.766044], [0.707107, -0.707107], [0.766044, -0.642788], [0.819152, -0.573576],
  [0.866025, -0.5], [0.906308, -0.422618], [0.939693, -0.34202], [0.965926, -0.258819], [0.984808, -0.173648], [0.996195, -0.087156],
];
export const BEARING_STEP_DEG = 5;

/** Bearing `k` (wrapped), a unit vector. */
const bearing = (k: number) => BEARINGS[((k % BEARINGS.length) + BEARINGS.length) % BEARINGS.length]!;

/**
 * A Landing Zone for a trip to `goal`: `lzM` (seeded) from its centre, on the bearing straight away from the enemies in `known`
 * within `lzThreatM` of it, turned a seeded amount up to `lzSpreadDeg` either way; any bearing when none is known. On ground a
 * Soldier can stand on (the nearest, when the drawn spot is not), then moved by `clear` (out of the enemy HQ circle).
 */
export function landingZone(m: Match, goal: Vec2, known: Vec2[], clear: (p: Vec2) => Vec2): Vec2 {
  const t = m.tune;
  const near = known.filter((e) => dist2(e, goal) <= t.lzThreatM * t.lzThreatM);
  const ax = goal.x - near.reduce((a, e) => a + e.x, 0) / (near.length || 1);
  const ay = goal.y - near.reduce((a, e) => a + e.y, 0) / (near.length || 1);
  let k = Math.floor(rnd(m) * BEARINGS.length);
  if (near.length && ax * ax + ay * ay > 1e-6) {
    const best = BEARINGS.reduce((b, u, i) => (u[0] * ax + u[1] * ay > BEARINGS[b]![0] * ax + BEARINGS[b]![1] * ay ? i : b), 0);
    const reach = Math.floor(t.lzSpreadDeg / BEARING_STEP_DEG);
    k = best + Math.floor(rnd(m) * (2 * reach + 1)) - reach;
  }
  const [ux, uy] = bearing(k);
  const r = between(m, t.lzM);
  return clear(nearestWalkable(m, { x: goal.x + ux * r, y: goal.y + uy * r }));
}

/** The distance from `p` to the segment a-b. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len2 = dx * dx + dy * dy;
  const u = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.sqrt(dist2(p, { x: a.x + dx * u, y: a.y + dy * u }));
}

/**
 * The waypoint of a trip `from` to `to`: `doglegFraction` (seeded) of the trip's length off the middle of the line, to a
 * seeded side, unless the trip is shorter than `doglegMinM` (null: straight). A side whose waypoint or legs pass within
 * `heliThreatM` of a threat (a point of radius `r`, or a known enemy of radius 0) loses to the other; with both threatened, the
 * one with more clearance wins. A side outside the Play Area is pulled back inside it.
 */
export function dogleg(m: Match, from: Vec2, to: Vec2, threats: (Vec2 & { r: number })[]): Vec2 | null {
  const t = m.tune;
  const len = Math.sqrt(dist2(from, to));
  if (len < t.doglegMinM) return null;
  const off = between(m, t.doglegFraction) * len;
  const side = rnd(m) < 0.5 ? -1 : 1;
  const [nx, ny] = [-(to.y - from.y) / len, (to.x - from.x) / len];
  const [mx, my] = [(from.x + to.x) / 2, (from.y + to.y) / 2];
  // a side that would leave the Play Area turns back toward the line in quarters (the middle of the trip is inside it)
  const waypoint = (s: number) => {
    for (let k = 1; k > 0; k -= 0.25) {
      const w = { x: mx + nx * off * s * k, y: my + ny * off * s * k };
      if (insidePolygon(m.map.playArea, w.x, w.y)) return w;
    }
    return { x: mx, y: my };
  };
  const [a, b] = [waypoint(side), waypoint(-side)];
  const clearance = (w: Vec2) => Math.min(Infinity, ...threats.map((p) => Math.min(segDist(p, from, w), segDist(p, w, to)) - p.r));
  return clearance(a) >= t.heliThreatM || clearance(a) >= clearance(b) ? a : b;
}
