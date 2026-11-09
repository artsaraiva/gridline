// #110: the jet. One per Side: its slot is a boarding marker in the HQ park, the aircraft lives at the off-map base (the
// Cruise Missile's launch point). Its pilot scores Capture Points as any Soldier, from the base; a sortie is `jetPasses`
// passes, each one inbound straight at the point (the cannon along the last `jetFireM` at what the Side knows there),
// overfly, outbound past the Play Area, a `jetTurnSeconds` turn; then home to rearm `jetRearmSeconds`. Never into the enemy
// HQ circle's air. Only the AA hurts it (vehicles.ts).
import type { Match } from './index';
import { bestPoint } from './ai/squad';
import { assetContacts } from './assets/core';
import { launchPoint } from './assets/missile';
import { dist2, insidePolygon } from './geometry';
import { turnToward } from './momentum';
import { ticksOf, vehicleOf, type Soldier, type Squad } from './state';
import { enemyOf } from './types';
import { clearOfHq, live, type Vehicle } from './vehicles';

/** Where a jet is in its sortie. Idle: no pilot, at the base. Rearming: flying home (`until` -1), then at the base until `until`. */
export const SORTIE = ['idle', 'inbound', 'outbound', 'turning', 'rearming'] as const;
export type Sortie = (typeof SORTIE)[number];

/** The Capture Point the pilot strafes next: scored as its Squad would score it, by straight-line distance from the base, `squadPull` on the Squad's goal. */
export function jetPoint(m: Match, sq: Squad, v: Vehicle): number {
  const b = launchPoint(m, v.side);
  return bestPoint(m, sq, b, m.tune.squadPull, { dist: (i) => Math.sqrt(dist2(b, m.points[i]!)) });
}

/** A fresh pilot takes off at once from the base on a full sortie. */
export function takeOff(m: Match, v: Vehicle) {
  v.passes = m.tune.jetPasses;
  nextPass(m, v);
}

/** The next pass, at the pilot's point (picked at its Squad's think); home when it has none. */
function nextPass(m: Match, v: Vehicle) {
  const p = m.points[v.goal];
  Object.assign(v, p ? { sortie: 'inbound', spot: { x: p.x, y: p.y }, airborne: true, until: -1 } : { sortie: 'rearming', until: -1 });
}

/** One tick of a piloted jet's sortie. */
export function sortie(m: Match, v: Vehicle) {
  const t = m.tune;
  if (v.sortie === 'inbound') {
    if (toward(m, v, v.spot!)) Object.assign(v, { sortie: 'outbound', passes: v.passes - 1 });
  } else if (v.sortie === 'outbound') {
    move(m, v, clearHq(m, v));
    if (insidePolygon(m.map.playArea, v.x, v.y)) return;
    const away = v.fx * -v.y - v.fy * -v.x >= 0 ? -1 : 1; // turns away from the map centre, so the turn stays off the map
    Object.assign(v, { sortie: 'turning', spin: away, until: m.tick + ticksOf(t, t.jetTurnSeconds) });
  } else if (v.sortie === 'turning') {
    move(m, v, turnToward(v.fx, v.fy, -v.fy * v.spin, v.fx * v.spin, 180 / t.jetTurnSeconds, t.hz)); // always a full step: the way is at a right angle
    if (m.tick < v.until) return;
    if (v.passes > 0) nextPass(m, v);
    else Object.assign(v, { sortie: 'rearming', until: -1 });
  } else if (v.sortie === 'rearming') {
    if (v.until < 0) {
      if (toward(m, v, launchPoint(m, v.side))) Object.assign(v, { airborne: false, until: m.tick + ticksOf(t, t.jetRearmSeconds) });
    } else if (m.tick >= v.until) takeOff(m, v);
  }
}

/** One tick straight at `to`; true once there. */
function toward(m: Match, v: Vehicle, to: { x: number; y: number }): boolean {
  const d = Math.sqrt(dist2(v, to));
  if (d <= m.tune.jetMps / m.tune.hz) {
    Object.assign(v, { x: to.x, y: to.y, movedAt: m.tick });
    return true;
  }
  move(m, v, { fx: (to.x - v.x) / d, fy: (to.y - v.y) / d });
  return false;
}

/** Outbound: straight on, bending away (at the turn's rate) while the enemy HQ circle lies across the way ahead. */
function clearHq(m: Match, v: Vehicle) {
  const hq = m.map.hqs[enemyOf(v.side)];
  const r = (hq.radius ?? m.tune.hqRadius) + 15;
  const [hx, hy] = [hq.x - v.x, hq.y - v.y];
  const across = v.fx * hy - v.fy * hx; // + the HQ on the left
  if (hx * v.fx + hy * v.fy <= 0 || across * across > r * r) return { fx: v.fx, fy: v.fy };
  const s = across >= 0 ? -1 : 1;
  return turnToward(v.fx, v.fy, -v.fy * s, v.fx * s, 180 / m.tune.jetTurnSeconds, m.tune.hz);
}

/** One tick at `jetMps` along `way`; a step into the enemy HQ circle goes round its rim instead (the tangent nearer the way). */
function move(m: Match, v: Vehicle, way: { fx: number; fy: number }) {
  const step = m.tune.jetMps / m.tune.hz;
  const hq = m.map.hqs[enemyOf(v.side)];
  const r = hq.radius ?? m.tune.hqRadius;
  let { fx, fy } = way;
  let at = { x: v.x + fx * step, y: v.y + fy * step };
  if (dist2(at, hq) < r * r) {
    const [rx, ry] = [v.x - hq.x, v.y - hq.y];
    const n = Math.sqrt(rx * rx + ry * ry) || 1;
    const s = fx * -ry + fy * rx >= 0 ? 1 : -1;
    [fx, fy] = [(-ry / n) * s, (rx / n) * s];
    at = clearOfHq(m, v.side, { x: v.x + fx * step, y: v.y + fy * step });
  }
  Object.assign(v, { x: at.x, y: at.y, fx, fy, speed: m.tune.jetMps, movedAt: m.tick });
}

/**
 * The cannon's mark, inbound within `jetFireM` of its point (the strip): the nearest enemy the Side knows this tick (its
 * Soldiers' and vehicles' sightings, and its Assets' Contacts: the jet's own eyes see nothing) within `jetStripM` of the
 * flight line ahead, no farther than `jetStripM` past the point. A Soldier on foot (not Wounded) or a vehicle (never a jet); null outside the strip.
 */
export function jetTarget(m: Match, v: Vehicle): Soldier | Vehicle | null {
  const t = m.tune;
  if (v.sortie !== 'inbound' || !v.spot) return null;
  const left = Math.sqrt(dist2(v, v.spot));
  if (left > t.jetFireM) return null;
  const known = new Set([...m.sightings[v.side].filter((s) => s.tick === m.tick).map((s) => s.id), ...assetContacts(m, v.side).map((s) => s.id)]);
  let best: Soldier | Vehicle | null = null;
  let bestAlong = left + t.jetStripM;
  for (const id of known) {
    const s = m.soldiers[id];
    const u = vehicleOf(m, id);
    const e = s ? (s.state === 'alive' && s.vehicle < 0 ? s : null) : u && live(u) && u.kind !== 'jet' ? u : null;
    if (!e) continue;
    const [dx, dy] = [e.x - v.x, e.y - v.y];
    const along = dx * v.fx + dy * v.fy;
    const off = dx * v.fy - dy * v.fx;
    if (along > 0 && along <= bestAlong && off * off <= t.jetStripM * t.jetStripM) [best, bestAlong] = [e, along];
  }
  return best;
}
