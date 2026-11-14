// #110: the jet. A Side's jets (#154: as many as its map lists) live at the off-map base (the Cruise Missile's launch point), each
// taking off with its pilot already aboard (`deployPilots`: at match start, #154 a seeded gap apart, then `jetOnReturn`: a Soldier coming back). Its pilot scores Capture Points as any
// Soldier, from the base; a sortie is `jetPasses`
// passes, each an attack run on a mark the Side knows by its pilot's point: inbound straight at it, the cannon along the
// last `jetFireM` at what the Side knows there (and a bomb on a vehicle or a group), overfly, outbound past the Play Area, a
// `jetTurnSeconds` turn; then home to rearm and repair `jetRearmSeconds`. An enemy jet in the air near it is fought first
// (`dogfight`: chase, cannon, lock-on missile). Never into the enemy HQ circle's air. Only the AA and the enemy jet hurt it.
import type { Match } from '../index';
import { bestPoint } from '../ai/squad';
import { assetContacts } from '../assets/core';
import { clearOfHq, dist2, inHq, insidePolygon, launchPoint } from '../geometry';
import { cosDeg, turnToward } from '../momentum';
import { between, pickWeighted, rnd } from '../rng';
import { membersOf, ticksOf, vehicleOf, type Soldier, type Squad } from '../state';
import { enemyOf, type SideId, type Vec2 } from '../types';
import { freshLock, lockOn } from '../air-missiles';
import { crippled, high, live, SPECS, type Vehicle, type VehicleOf } from './body';
import { mount, type Shot, type Shots, type VehicleRules } from './core';
import { rifleChance } from './seats';

/** Where a jet is in its sortie. Idle: no pilot, at the base. Rearming: flying home (`until` -1), then at the base until `until`. */
export const SORTIE = ['idle', 'inbound', 'outbound', 'turning', 'rearming', 'dogfight'] as const;
export type Stage = (typeof SORTIE)[number];

/**
 * #110: a jet's sortie: its `stage`, the `passes` and `bombs` left, its `prey` (the enemy its pass is aimed at, or the enemy jet it
 * fights; -1 = none), the pass's point it flies `at`, which way it `turn`s round (1 counter-clockwise, -1 clockwise), the tick its
 * turn, dogfight or rearm ends (`until`, -1 = not begun), and whether this pass drops a `bomb`.
 */
export interface Sortie {
  stage: Stage;
  passes: number;
  bombs: number;
  prey: number;
  at: Vec2 | null;
  turn: number;
  until: number;
  bomb: boolean;
}
type Jet = VehicleOf<'jet'>;

/** The Capture Point the pilot strafes next: scored as its Squad would score it, by straight-line distance from the base, `squadPull` on the Squad's goal. */
export function jetPoint(m: Match, sq: Squad, v: Vehicle): number {
  const b = launchPoint(m, v.side);
  return bestPoint(m, sq, b, m.tune.squadPull, { dist: (i) => Math.sqrt(dist2(b, m.points[i]!)) });
}

/**
 * #110: a Soldier coming back (Squad Respawn or Redeploy) spawns as the pilot of its Side's empty jet, taking off from the base,
 * as BF4's deploy screen puts you in the air. Never the Squad Leader (the Squad scores, leads and comes back from them, and a
 * pilot is off at the base or in the sky), and none while a member of its Squad flies one. True when it did.
 */
export function jetOnReturn(m: Match, sq: Squad, s: Soldier): boolean {
  if (s.id === sq.members[0] || membersOf(m, sq).some((o) => o !== s && vehicleOf(m, o.vehicle)?.kind === 'jet')) return false;
  const v = m.vehicles.find((o) => o.kind === 'jet' && o.side === s.side && live(o) && o.seats[0]! < 0);
  if (!v) return false;
  mount(m, v, s, sq);
  return true;
}

/**
 * #110: at match start each jet gets a pilot: the last member of one of its Side's Squads of two or more, seeded; #154 never
 * a Squad that already has one. A Side's first jet takes off at once, each next one waits at the base a seeded `jetGapSeconds`
 * after the one before.
 */
export function deployPilots(m: Match) {
  const offAt: Partial<Record<SideId, number>> = {}; // the tick the Side's previous jet takes off
  for (const v of m.vehicles) {
    if (v.kind !== 'jet') continue;
    const squads = m.squads.filter((sq) => sq.side === v.side && sq.members.length > 1 && !membersOf(m, sq).some((s) => vehicleOf(m, s.vehicle)?.kind === 'jet'));
    const sq = squads[Math.floor(rnd(m) * squads.length)];
    if (!sq) continue;
    mount(m, v, m.soldiers[sq.members.at(-1)!]!, sq);
    const previous = offAt[v.side];
    // #154 says "a seeded delay after it": after the one before, not the first, so no two later jets leave together either. The
    // gap is drawn only for a later jet, so a Side with one jet draws exactly as before
    offAt[v.side] = previous === undefined ? m.tick : previous + ticksOf(m.tune, between(m, m.tune.jetGapSeconds));
    if (previous !== undefined) { // the rearm's wait at the base: `sortie` takes off at `until`
      Object.assign(v.sortie, { stage: 'rearming', until: offAt[v.side], prey: -1, bomb: false });
      v.airborne = false;
    }
  }
}

/** A fresh pilot takes off at once from the base on a full sortie. */
export function takeOff(m: Match, v: Jet) {
  Object.assign(v.sortie, { passes: m.tune.jetPasses, bombs: m.tune.jetBombs });
  nextPass(m, v);
}

const home = (v: Jet) => Object.assign(v.sortie, { stage: 'rearming', until: -1, prey: -1, bomb: false });

/** Where the Side knows its enemies: each one's last seen spot (its sightings, kept `lkpSeconds`), and its Assets' Contacts where they are. */
export function known(m: Match, side: SideId): Map<number, Vec2> {
  const spots = new Map(m.sightings[side].map((s) => [s.id, { x: s.x, y: s.y }]));
  for (const s of assetContacts(m, side)) spots.set(s.id, { x: s.x, y: s.y });
  return spots;
}

/** An enemy a pass may be aimed at or the cannon fire on: a Soldier on foot, not Wounded, or a live vehicle but a jet (#101 or the Gunship). */
export function markable(m: Match, id: number): boolean {
  const s = m.soldiers[id];
  const u = vehicleOf(m, id);
  return s ? s.state === 'alive' && s.vehicle < 0 : !!u && live(u) && !high(u);
}

/** The next pass, at the pilot's point (picked at its Squad's think); home when it has none. */
function nextPass(m: Match, v: Jet) {
  const p = m.points[v.goal];
  if (!p) return home(v);
  Object.assign(v.sortie, { stage: 'inbound', prey: -1, at: { x: p.x, y: p.y }, bomb: false, until: -1 });
  v.airborne = true;
  aim(m, v);
}

/**
 * Aims the pass at a mark drawn among the enemies the Side knows (the nearer the pilot's point the likelier, a vehicle three
 * times so); with none known it stays on the point. With a bomb left, a vehicle or a group of `jetBombGroup` known within
 * `jetBombGroupM` of the mark gets one.
 */
function aim(m: Match, v: Jet) {
  const t = m.tune;
  const p = m.points[v.goal] ?? v.sortie.at!;
  const marks = [...known(m, v.side)].filter(([id]) => markable(m, id));
  if (!marks.length) return;
  const [prey, spot] = marks[Math.max(0, pickWeighted(m, marks.map(([id, s]) => (vehicleOf(m, id) ? 3 : 1) / (1 + dist2(s, p) / 10000))))]!;
  const group = !!vehicleOf(m, prey) || marks.filter(([id, s]) => m.soldiers[id] && dist2(s, spot) <= t.jetBombGroupM * t.jetBombGroupM).length >= t.jetBombGroup;
  Object.assign(v.sortie, { prey, at: spot, bomb: v.sortie.bombs > 0 && group });
}

/** A jet over its own HQ, within this past the circle, is left alone: a chase there would only circle the rim it may not cross. */
const HOME_SAFE_M = 150;

/**
 * The enemy jet worth fighting: in the air within `jetDogfightM` (x `reach`), not a third down and not over its own HQ; #154 one
 * no other friendly jet is fighting first; if any.
 */
function foeJet(m: Match, v: Jet, reach = 1): Jet | undefined {
  const safe = (u: Vehicle) => (m.map.hqs[u.side].radius ?? m.tune.hqRadius) + HOME_SAFE_M;
  const foes = m.vehicles.filter((u): u is Jet => u.kind === 'jet' && u.side !== v.side && live(u) && u.airborne && !crippled(m, u) && dist2(u, v) <= (m.tune.jetDogfightM * reach) ** 2 && dist2(u, m.map.hqs[u.side]) > safe(u) ** 2);
  const fought = (u: Vehicle) => m.vehicles.some((o) => o !== v && o.kind === 'jet' && o.side === v.side && live(o) && o.sortie.stage === 'dogfight' && o.sortie.prey === u.id);
  return foes.find((u) => !fought(u)) ?? foes[0];
}

/** `e` lies within a `deg` cone ahead of `v`'s nose and `r` metres. */
function ahead(v: Vehicle, e: Vec2, deg: number, r: number): boolean {
  const d2 = dist2(v, e);
  return d2 <= r * r && (e.x - v.x) * v.fx + (e.y - v.y) * v.fy >= cosDeg(deg / 2) * Math.sqrt(d2);
}

/** One tick of a piloted jet's sortie. */
export function sortie(m: Match, v: Jet) {
  const t = m.tune;
  const foe = (v.sortie.stage === 'inbound' || v.sortie.stage === 'outbound' || v.sortie.stage === 'turning') && !crippled(m, v) ? foeJet(m, v) : undefined;
  if (foe) Object.assign(v.sortie, { stage: 'dogfight', prey: foe.id, bomb: false, until: m.tick + ticksOf(t, t.jetDogfightSeconds) });
  if (v.sortie.stage === 'inbound') {
    const at = markable(m, v.sortie.prey) ? known(m, v.side).get(v.sortie.prey) : undefined;
    if (at) v.sortie.at = at; // the run follows its mark to where the Side last saw it
    else if (v.sortie.prey < 0 && dist2(v, v.sortie.at!) > t.jetFireM * t.jetFireM) aim(m, v); // a mark the Side finds while it flies in
    if (v.sortie.bomb && dist2(v, v.sortie.at!) <= (t.jetMps * t.jetBombFallSeconds) ** 2 && !inHq(m, v.side, v)) bomb(m, v); // nor out of its own HQ (combat.ts fire)
    if (toward(m, v, v.sortie.at!, true)) Object.assign(v.sortie, { stage: 'outbound', passes: v.sortie.passes - 1 });
  } else if (v.sortie.stage === 'dogfight') dogfight(m, v);
  else if (v.sortie.stage === 'outbound') {
    move(m, v, clearHq(m, v));
    if (insidePolygon(m.map.playArea, v.x, v.y)) return;
    const away = v.fx * -v.y - v.fy * -v.x >= 0 ? -1 : 1; // turns away from the map centre, so the turn stays off the map
    Object.assign(v.sortie, { stage: 'turning', turn: away, until: m.tick + ticksOf(t, t.jetTurnSeconds) });
  } else if (v.sortie.stage === 'turning') {
    move(m, v, turnToward(v.fx, v.fy, -v.fy * v.sortie.turn, v.fx * v.sortie.turn, 180 / t.jetTurnSeconds, t.hz)); // always a full step: the way is at a right angle
    if (m.tick < v.sortie.until) return;
    if (v.sortie.passes > 0) nextPass(m, v);
    else home(v);
  } else if (v.sortie.stage === 'rearming') {
    if (v.sortie.until < 0) {
      if (toward(m, v, launchPoint(m, v.side))) {
        v.airborne = false;
        v.sortie.until = m.tick + ticksOf(t, t.jetRearmSeconds);
      }
    } else if (m.tick >= v.sortie.until) {
      v.hp = SPECS[v.kind].hp(t); // repaired with the rearm
      takeOff(m, v);
    }
  }
}

/** Releases the pass's bomb `jetBombFallSeconds` short of its spot: it lands there then, up to `jetBombScatterM` off (seeded). */
function bomb(m: Match, v: Jet) {
  const t = m.tune;
  const r = t.jetBombScatterM;
  const at = { x: v.sortie.at!.x + (rnd(m) * 2 - 1) * r, y: v.sortie.at!.y + (rnd(m) * 2 - 1) * r };
  v.rounds.push({ x0: v.x, y0: v.y, ...at, launch: m.tick, land: m.tick + ticksOf(t, t.jetBombFallSeconds), bomb: true });
  Object.assign(v.sortie, { bombs: v.sortie.bombs - 1, bomb: false });
}

/** A fighting jet steers for a spot this far behind the other's tail: on its six, not at its nose. */
const TAIL_M = 150;
/** The other this close on its tail (in its rear 60 degrees) makes it break: a hard turn, reversed now and then. */
const BREAK_M = 600;
/** A breaking jet reverses its turn about this often (seeded), so a chaser cannot just sit inside its circle. */
const REVERSE_S = 3;

/**
 * One tick fighting the enemy jet `prey`, at full speed, turning at `jetTurnDegPerS` x its pilot's quickness (the quicker their
 * reaction, the tighter the turn: the quicker comes round first after a merge). With the other close behind it, it breaks: a
 * hard turn, reversed about every `REVERSE_S`. On the other's six it chases it straight; else it turns for the spot `TAIL_M`
 * behind it. The cannon fires on it ahead, the missile on it ahead from behind (`jetTarget`, `jetLock`). It breaks off once the fight has run `jetDogfightSeconds` or it
 * is a third down (home), or when the other is gone, far off, a third down or over its own HQ (back to its passes).
 */
function dogfight(m: Match, v: Jet) {
  const t = m.tune;
  const foe = vehicleOf(m, v.sortie.prey);
  if (crippled(m, v) || m.tick >= v.sortie.until) return home(v);
  if (!foe || foeJet(m, v, 1.5) !== foe) {
    v.sortie.prey = -1;
    return v.sortie.passes > 0 ? nextPass(m, v) : home(v);
  }
  const rate = t.jetTurnDegPerS * (1.25 - m.soldiers[v.seats[0]!]!.reaction / 2);
  const [dx, dy] = [foe.x - v.x, foe.y - v.y];
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  if (d < BREAK_M && dx * v.fx + dy * v.fy <= -cosDeg(30) * d) {
    if (rnd(m) * REVERSE_S * t.hz < 1) v.sortie.turn = -v.sortie.turn;
    return move(m, v, turnToward(v.fx, v.fy, -v.fy * v.sortie.turn, v.fx * v.sortie.turn, rate, t.hz));
  }
  const aim = dx * foe.fx + dy * foe.fy >= 0.5 * d ? foe : { x: foe.x - foe.fx * TAIL_M, y: foe.y - foe.fy * TAIL_M };
  const a = Math.sqrt(dist2(v, aim)) || 1;
  move(m, v, turnToward(v.fx, v.fy, (aim.x - v.x) / a, (aim.y - v.y) / a, rate, t.hz));
}

/**
 * The enemy jet a fighting jet's missile locks on: held within `jetLockDeg` ahead and `jetMissileRangeM`, and from behind it
 * (within 60 degrees of its tail: a heat seeker never locks head on); -1 = none.
 */
export function jetLock(m: Match, v: Jet): number {
  const foe = v.sortie.stage === 'dogfight' ? vehicleOf(m, v.sortie.prey) : undefined;
  if (!foe || !live(foe) || !ahead(v, foe, m.tune.jetLockDeg, m.tune.jetMissileRangeM)) return -1;
  const behind = (foe.x - v.x) * foe.fx + (foe.y - v.y) * foe.fy >= cosDeg(60) * Math.sqrt(dist2(v, foe));
  return behind ? foe.id : -1;
}

/**
 * One tick toward `to`, turning at `jetTurnDegPerS` (never a sudden about-face); true once there, or (`overfly`, a pass) once
 * it lies abeam or behind: the run has passed over it.
 */
function toward(m: Match, v: Vehicle, to: Vec2, overfly = false): boolean {
  const t = m.tune;
  const d = Math.sqrt(dist2(v, to));
  if (d <= t.jetMps / t.hz) {
    Object.assign(v, { x: to.x, y: to.y, movedAt: m.tick });
    return true;
  }
  if (overfly && d <= t.jetFireM && (to.x - v.x) * v.fx + (to.y - v.y) * v.fy <= 0) return true;
  move(m, v, turnToward(v.fx, v.fy, (to.x - v.x) / d, (to.y - v.y) / d, t.jetTurnDegPerS, t.hz));
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
export function jetTarget(m: Match, v: Jet): Soldier | Vehicle | null {
  const t = m.tune;
  if (v.sortie.stage === 'dogfight') {
    const foe = vehicleOf(m, v.sortie.prey);
    return foe && live(foe) && ahead(v, foe, t.jetGunDeg, t.jetFireM) ? foe : null;
  }
  if (v.sortie.stage !== 'inbound' || !v.sortie.at) return null;
  const left = Math.sqrt(dist2(v, v.sortie.at));
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

export const jet: VehicleRules<'jet'> = {
  init: () => ({ sortie: { stage: 'idle', passes: 0, bombs: 0, prey: -1, at: null, turn: 1, until: -1, bomb: false }, missile: freshLock() }),
  /** #110: a piloted jet flies its sortie; without a pilot it waits at the base. */
  move(m, v) {
    if (v.seats[0]! >= 0) sortie(m, v);
  },
  goal: (m, sq, _s, v) => jetPoint(m, sq, v), // the point of its next pass
  onDriver(m, sq, _s, v) { // the pilot picks its point and takes off from the base
    v.goal = jetPoint(m, sq, v);
    takeOff(m, v);
  },
  onReturn: jetOnReturn,
  wantsOut: () => false, // its pilot never gets out
  seatFire: cannon,
  lock: (m, v) => lockOn(m, v, v.missile, jetLock(m, v), m.tune.jetLockSeconds, m.tune.jetReloadSeconds), // on the enemy jet it fights
  inSky: (m, v) => v.airborne && insidePolygon(m.map.playArea, v.x, v.y), // over the Play Area
};

/**
 * #110: a jet's cannon in its strip, at what the Side knows (`jetTarget`): the rifle shot model, `jetVsVehicleDamage` a hit on a
 * vehicle. With no Contact in the strip it rakes its mark's last known spot instead, as suppressive fire scattered `jetStripM`.
 */
function cannon(m: Match, s: Soldier, v: Jet, shots: Shots): Shot | null {
  const t = m.tune;
  if (m.tick < s.nextFire) return null;
  const e = jetTarget(m, v);
  if (!e) return v.sortie.stage === 'inbound' && v.sortie.prey >= 0 && dist2(v, v.sortie.at!) <= t.jetFireM * t.jetFireM ? shots.rake(m, s, v.sortie.at!, t.jetStripM, t.jetFireSeconds) : null;
  if ('kind' in e) {
    const shot = shots.roll(m, s, null, t.hitChance, t.jetFireSeconds, e);
    return { ...shot, damage: shot.hit ? (e.kind === 'jet' ? t.jetVsJetDamage : t.jetVsVehicleDamage) : 0 };
  }
  return shots.roll(m, s, e, rifleChance(m, e), t.jetFireSeconds);
}
