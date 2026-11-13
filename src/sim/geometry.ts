import type { Match } from './index';
import { walkCost } from './grid';
import type { Soldier } from './state';
import { enemyOf, type Hq, type SideId, type Vec2 } from './types';

export const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

/** Squared distance from `p` to the segment from `a` to `b`. */
export function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const k = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return dist2(p, { x: a.x + dx * k, y: a.y + dy * k });
}

/** Even-odd point-in-polygon. */
export function insidePolygon(poly: Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const CENTRE = { x: 0, y: 0 };
/** #150: the keystone Capture Points: those the map names, else the one nearest the map centre (Lane 2 on Kaltenbach); none on a map with no points. */
export function keystone(m: Match) {
  const named = m.map.keystone;
  if (named) return m.points.filter((p) => named.includes(p.id));
  const middle = m.points.reduce<Match['points'][number] | undefined>((a, p) => (!a || dist2(p, CENTRE) < dist2(a, CENTRE) ? p : a), undefined);
  return middle ? [middle] : [];
}

/** Whether the HQ holds the spot: inside its `area`, or without one inside its circle (`hqRadius` wide when it names no radius). */
export const hqHolds = (hq: Hq, hqRadius: number, p: Vec2) => (hq.area ? insidePolygon(hq.area, p.x, p.y) : dist2(p, hq) < (hq.radius ?? hqRadius) ** 2);

/** #138: whether the straight line from `a` to `b` touches the HQ, sampled every 2 m (an HQ area is no circle to measure against). */
export function lineHits(hq: Hq, hqRadius: number, a: Vec2, b: Vec2): boolean {
  const n = Math.ceil(Math.sqrt(dist2(a, b)) / 2);
  for (let k = 0; k <= n; k++) if (hqHolds(hq, hqRadius, n ? { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n } : a)) return true;
  return false;
}

export const inHq = (m: Match, side: SideId, p: Vec2) => hqHolds(m.map.hqs[side], m.tune.hqRadius, p);

/** The Play Area boundary, walls, water and the enemy HQ are walls to a Soldier. */
export const canStand = (m: Match, s: Soldier, p: Vec2) =>
  insidePolygon(m.map.playArea, p.x, p.y) && walkCost(m, p.x, p.y) > 0 && !inHq(m, enemyOf(s.side), p);
