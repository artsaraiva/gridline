// #110: the jet. One per Side: its slot is a boarding marker in the HQ park, the aircraft lives at the off-map base (the
// Cruise Missile's launch point). Its pilot scores Capture Points as any Soldier, from the base; a sortie is `jetPasses`
// passes, each an attack run on a mark the Side knows by its pilot's point: inbound straight at it, the cannon along the
// last `jetFireM` at what the Side knows there (and a bomb on a vehicle or a group), overfly, outbound past the Play Area, a
// `jetTurnSeconds` turn; then home to rearm and repair `jetRearmSeconds`. An enemy jet in the air near it is fought first
// (`dogfight`: chase, cannon, lock-on missile). Never into the enemy HQ circle's air. Only the AA and the enemy jet hurt it.
import type { Match } from './index';
import { bestPoint } from './ai/squad';
import { assetContacts } from './assets/core';
import { launchPoint } from './assets/missile';
import { dist2, insidePolygon } from './geometry';
import { cosDeg, turnToward } from './momentum';
import { pickWeighted, rnd } from './rng';
import { ticksOf, vehicleOf, type Soldier, type Squad } from './state';
import { enemyOf, type SideId, type Vec2 } from './types';
import { clearOfHq, crippled, live, specOf, type Vehicle } from './vehicles';

/** Where a jet is in its sortie. Idle: no pilot, at the base. Rearming: flying home (`until` -1), then at the base until `until`. */
export const SORTIE = ['idle', 'inbound', 'outbound', 'turning', 'rearming', 'dogfight'] as const;
export type Sortie = (typeof SORTIE)[number];

/** The Capture Point the pilot strafes next: scored as its Squad would score it, by straight-line distance from the base, `squadPull` on the Squad's goal. */
export function jetPoint(m: Match, sq: Squad, v: Vehicle): number {
  const b = launchPoint(m, v.side);
  return bestPoint(m, sq, b, m.tune.squadPull, { dist: (i) => Math.sqrt(dist2(b, m.points[i]!)) });
}

/** A fresh pilot takes off at once from the base on a full sortie. */
export function takeOff(m: Match, v: Vehicle) {
  Object.assign(v, { passes: m.tune.jetPasses, bombs: m.tune.jetBombs });
  nextPass(m, v);
}

const home = (v: Vehicle) => Object.assign(v, { sortie: 'rearming', until: -1, prey: -1, drop: false });

/** Where the Side knows its enemies: each one's last seen spot (its sightings, kept `lkpSeconds`), and its Assets' Contacts where they are. */
function known(m: Match, side: SideId): Map<number, Vec2> {
  const spots = new Map(m.sightings[side].map((s) => [s.id, { x: s.x, y: s.y }]));
  for (const s of assetContacts(m, side)) spots.set(s.id, { x: s.x, y: s.y });
  return spots;
}

/** An enemy a pass may be aimed at or the cannon fire on: a Soldier on foot, not Wounded, or a live vehicle but a jet. */
function markable(m: Match, id: number): boolean {
  const s = m.soldiers[id];
  const u = vehicleOf(m, id);
  return s ? s.state === 'alive' && s.vehicle < 0 : !!u && live(u) && u.kind !== 'jet';
}

/** The next pass, at the pilot's point (picked at its Squad's think); home when it has none. */
function nextPass(m: Match, v: Vehicle) {
  const p = m.points[v.goal];
  if (!p) return home(v);
  Object.assign(v, { sortie: 'inbound', prey: -1, spot: { x: p.x, y: p.y }, drop: false, airborne: true, until: -1 });
  aim(m, v);
}

/**
 * Aims the pass at a mark drawn among the enemies the Side knows (the nearer the pilot's point the likelier, a vehicle three
 * times so); with none known it stays on the point. With a bomb left, a vehicle or a group of `jetBombGroup` known within
 * `jetBombGroupM` of the mark gets one.
 */
function aim(m: Match, v: Vehicle) {
  const t = m.tune;
  const p = m.points[v.goal] ?? v.spot!;
  const marks = [...known(m, v.side)].filter(([id]) => markable(m, id));
  if (!marks.length) return;
  const [prey, spot] = marks[Math.max(0, pickWeighted(m, marks.map(([id, s]) => (vehicleOf(m, id) ? 3 : 1) / (1 + dist2(s, p) / 10000))))]!;
  const group = !!vehicleOf(m, prey) || marks.filter(([id, s]) => m.soldiers[id] && dist2(s, spot) <= t.jetBombGroupM * t.jetBombGroupM).length >= t.jetBombGroup;
  Object.assign(v, { prey, spot, drop: v.bombs > 0 && group });
}

/** The enemy jet in the air within `jetDogfightM` (x `reach`), if any. */
const foeJet = (m: Match, v: Vehicle, reach = 1) => m.vehicles.find((u) => u.kind === 'jet' && u.side !== v.side && live(u) && u.airborne && dist2(u, v) <= (m.tune.jetDogfightM * reach) ** 2);

/** `e` lies within a `deg` cone ahead of `v`'s nose and `r` metres. */
function ahead(v: Vehicle, e: Vec2, deg: number, r: number): boolean {
  const d2 = dist2(v, e);
  return d2 <= r * r && (e.x - v.x) * v.fx + (e.y - v.y) * v.fy >= cosDeg(deg / 2) * Math.sqrt(d2);
}

/** One tick of a piloted jet's sortie. */
export function sortie(m: Match, v: Vehicle) {
  const t = m.tune;
  const foe = (v.sortie === 'inbound' || v.sortie === 'outbound' || v.sortie === 'turning') && !crippled(m, v) ? foeJet(m, v) : undefined;
  if (foe) Object.assign(v, { sortie: 'dogfight', prey: foe.id, drop: false, until: m.tick + ticksOf(t, t.jetDogfightSeconds) });
  if (v.sortie === 'inbound') {
    const at = markable(m, v.prey) ? known(m, v.side).get(v.prey) : undefined;
    if (at) v.spot = at; // the run follows its mark to where the Side last saw it
    else if (v.prey < 0 && dist2(v, v.spot!) > t.jetFireM * t.jetFireM) aim(m, v); // a mark the Side finds while it flies in
    if (v.drop && dist2(v, v.spot!) <= (t.jetMps * t.jetBombFallSeconds) ** 2) bomb(m, v);
    if (toward(m, v, v.spot!)) Object.assign(v, { sortie: 'outbound', passes: v.passes - 1 });
  } else if (v.sortie === 'dogfight') dogfight(m, v);
  else if (v.sortie === 'outbound') {
    move(m, v, clearHq(m, v));
    if (insidePolygon(m.map.playArea, v.x, v.y)) return;
    const away = v.fx * -v.y - v.fy * -v.x >= 0 ? -1 : 1; // turns away from the map centre, so the turn stays off the map
    Object.assign(v, { sortie: 'turning', spin: away, until: m.tick + ticksOf(t, t.jetTurnSeconds) });
  } else if (v.sortie === 'turning') {
    move(m, v, turnToward(v.fx, v.fy, -v.fy * v.spin, v.fx * v.spin, 180 / t.jetTurnSeconds, t.hz)); // always a full step: the way is at a right angle
    if (m.tick < v.until) return;
    if (v.passes > 0) nextPass(m, v);
    else home(v);
  } else if (v.sortie === 'rearming') {
    if (v.until < 0) {
      if (toward(m, v, launchPoint(m, v.side))) Object.assign(v, { airborne: false, until: m.tick + ticksOf(t, t.jetRearmSeconds) });
    } else if (m.tick >= v.until) {
      v.hp = specOf(t, v.kind).hp; // repaired with the rearm
      takeOff(m, v);
    }
  }
}

/** Releases the pass's bomb `jetBombFallSeconds` short of its spot: it lands there then, up to `jetBombScatterM` off (seeded). */
function bomb(m: Match, v: Vehicle) {
  const t = m.tune;
  const r = t.jetBombScatterM;
  const at = { x: v.spot!.x + (rnd(m) * 2 - 1) * r, y: v.spot!.y + (rnd(m) * 2 - 1) * r };
  v.rounds.push({ x0: v.x, y0: v.y, ...at, launch: m.tick, land: m.tick + ticksOf(t, t.jetBombFallSeconds), bomb: true });
  Object.assign(v, { bombs: v.bombs - 1, drop: false });
}

/**
 * One tick fighting the enemy jet `prey`: it turns after it at `jetDogfightDegPerS` x its pilot's quickness (the quicker their
 * reaction, the tighter the turn: two equal jets would only circle), at full speed, the cannon and missile on it when it is
 * ahead (`jetTarget`, `jetLock`). It breaks off once the fight has run `jetDogfightSeconds` or it is a third down (home), or
 * when the other is gone, far off or a third down (back to its passes).
 */
function dogfight(m: Match, v: Vehicle) {
  const t = m.tune;
  const foe = vehicleOf(m, v.prey);
  if (crippled(m, v) || m.tick >= v.until) return home(v);
  if (!foe || !live(foe) || !foe.airborne || crippled(m, foe) || !foeJet(m, v, 1.5)) {
    v.prey = -1;
    return v.passes > 0 ? nextPass(m, v) : home(v);
  }
  const d = Math.sqrt(dist2(v, foe)) || 1;
  const quick = 1.25 - m.soldiers[v.seats[0]!]!.reaction / 2;
  move(m, v, turnToward(v.fx, v.fy, (foe.x - v.x) / d, (foe.y - v.y) / d, t.jetDogfightDegPerS * quick, t.hz));
}

/** The enemy jet a fighting jet's missile locks on: held within `jetLockDeg` ahead and `jetMissileRangeM`; -1 = none. */
export function jetLock(m: Match, v: Vehicle): number {
  const foe = v.sortie === 'dogfight' ? vehicleOf(m, v.prey) : undefined;
  return foe && live(foe) && ahead(v, foe, m.tune.jetLockDeg, m.tune.jetMissileRangeM) ? foe.id : -1;
}

/** One tick straight at `to`; true once there. */
function toward(m: Match, v: Vehicle, to: Vec2): boolean {
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
 * The cannon's mark, inbound within `jetFireM` of its spot (the strip): the nearest enemy the Side knows this tick (its
 * Soldiers' and vehicles' sightings, and its Assets' Contacts: the jet's own eyes see nothing) within `jetStripM` of the
 * flight line ahead, no farther than `jetStripM` past the spot; null outside the strip. In a dogfight, the enemy jet when it
 * is within `jetGunDeg` ahead and `jetFireM`.
 */
export function jetTarget(m: Match, v: Vehicle): Soldier | Vehicle | null {
  const t = m.tune;
  if (v.sortie === 'dogfight') {
    const foe = vehicleOf(m, v.prey);
    return foe && live(foe) && ahead(v, foe, t.jetGunDeg, t.jetFireM) ? foe : null;
  }
  if (v.sortie !== 'inbound' || !v.spot) return null;
  const left = Math.sqrt(dist2(v, v.spot));
  if (left > t.jetFireM) return null;
  const seen = new Set([...m.sightings[v.side].filter((s) => s.tick === m.tick).map((s) => s.id), ...assetContacts(m, v.side).map((s) => s.id)]);
  let best: Soldier | Vehicle | null = null;
  let bestAlong = left + t.jetStripM;
  for (const id of seen) {
    if (!markable(m, id)) continue;
    const e = m.soldiers[id] ?? vehicleOf(m, id)!;
    const [dx, dy] = [e.x - v.x, e.y - v.y];
    const along = dx * v.fx + dy * v.fy;
    const off = dx * v.fy - dy * v.fx;
    if (along > 0 && along <= bestAlong && off * off <= t.jetStripM * t.jetStripM) [best, bestAlong] = [e, along];
  }
  return best;
}
