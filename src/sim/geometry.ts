import type { Match } from './index';
import { walkCost } from './grid';
import type { Soldier } from './state';
import { enemyOf, type SideId, type Vec2 } from './types';

export const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

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

export const inHq = (m: Match, side: SideId, p: Vec2) => {
  const hq = m.map.hqs[side];
  const r = hq.radius ?? m.tune.hqRadius;
  return dist2(p, hq) < r * r;
};

/** The Play Area boundary, walls, water and the enemy HQ are walls to a Soldier. */
export const canStand = (m: Match, s: Soldier, p: Vec2) =>
  insidePolygon(m.map.playArea, p.x, p.y) && walkCost(m, p.x, p.y) > 0 && !inHq(m, enemyOf(s.side), p);
