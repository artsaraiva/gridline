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

/**
 * #139: the straight line through `at` along the unit direction (ux, uy), cut where it enters and leaves `poly` (the outermost
 * crossings, so a notch in the edge does not end it) and run `beyond` metres past each: where it starts and where it ends.
 */
export function chord(poly: Vec2[], at: Vec2, ux: number, uy: number, beyond = 0): { from: Vec2; to: Vec2 } {
  let lo = 0;
  let hi = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const ex = poly[i]!.x - a.x;
    const ey = poly[i]!.y - a.y;
    const denom = ux * ey - uy * ex;
    if (denom === 0) continue;
    const k = ((a.x - at.x) * ey - (a.y - at.y) * ex) / denom; // metres along the line
    const u = ((a.x - at.x) * uy - (a.y - at.y) * ux) / denom; // 0..1 along the edge
    if (u < 0 || u > 1) continue;
    lo = Math.min(lo, k);
    hi = Math.max(hi, k);
  }
  return { from: { x: at.x + ux * (lo - beyond), y: at.y + uy * (lo - beyond) }, to: { x: at.x + ux * (hi + beyond), y: at.y + uy * (hi + beyond) } };
}

export const inHq = (m: Match, side: SideId, p: Vec2) => hqHolds(m.map.hqs[side], m.tune.hqRadius, p);

/** `p` pushed out of the enemy HQ circle (a helicopter never enters it); `margin` metres past the rim. */
export function clearOfHq(m: Match, side: SideId, p: Vec2, margin = 0): Vec2 {
  const hq = m.map.hqs[enemyOf(side)];
  const r = (hq.radius ?? m.tune.hqRadius) + margin;
  const e2 = dist2(p, hq);
  return e2 < r * r ? { x: hq.x + ((p.x - hq.x) * r) / Math.sqrt(e2), y: hq.y + ((p.y - hq.y) * r) / Math.sqrt(e2) } : p; // ponytail: slides round the rim; stalls only on a line through its exact centre
}

/** The Play Area boundary, walls, water and the enemy HQ are walls to a Soldier. */
export const canStand = (m: Match, s: Soldier, p: Vec2) =>
  insidePolygon(m.map.playArea, p.x, p.y) && walkCost(m, p.x, p.y) > 0 && !inHq(m, enemyOf(s.side), p);

/** #99: the launch point sits this far beyond the Play Area edge. */
const BEYOND_M = 1100;

/** #99: `side`'s launch point, where the ray from the map centre through its HQ leaves the Play Area, BEYOND_M further on (#110 its jets' off-map base, #101 where its Gunship flies from). */
export function launchPoint(m: Match, side: SideId): Vec2 {
  const d = m.map.hqs[side];
  const poly = m.map.playArea;
  let far = 1; // the HQ itself, should the ray miss every edge
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!;
    const ex = poly[i]!.x - a.x;
    const ey = poly[i]!.y - a.y;
    const denom = d.x * ey - d.y * ex;
    if (denom === 0) continue;
    const t = (a.x * ey - a.y * ex) / denom;
    const u = (a.x * d.y - a.y * d.x) / denom;
    if (u >= 0 && u <= 1 && t > far) far = t;
  }
  const len = Math.sqrt(d.x * d.x + d.y * d.y) || 1;
  return { x: d.x * far + (d.x / len) * BEYOND_M, y: d.y * far + (d.y / len) * BEYOND_M };
}
