// #123: a ground vehicle's tick in the vehicle phase (`groundMove`, the tank's, the jeep's and the AA's) and its drive step:
// along its route's flow field or its detour (drive-route.ts), with momentum.
import type { Match } from '../index';
import { driveFlow, flowDist, flowLook } from '../ai/flow';
import { approach, BRAKE_RESERVE, cosDeg, stopSpeed, turnToward } from '../momentum';
import { dist2 } from '../geometry';
import { cellIndex, openRun } from '../grid';
import type { Soldier, Squad } from '../state';
import type { Vec2 } from '../types';
import { SPECS, type Ground, type VehicleOf } from './body';
import type { VehicleRules } from './core';
import { alongPath, overCrossing, pickRoute, routeFlow } from './drive-route';
import { takeWheel } from './seats';

/** #107 #108: a ground vehicle's tick in the vehicle phase: with a driver and a goal it drives once full or its driver's wait for others is out; else it stands. */
export function groundMove(m: Match, v: Ground, halted: boolean) {
  if (v.seats[0]! >= 0 && v.goal >= 0 && (!v.seats.includes(-1) || m.tick >= v.departAt)) step(m, v, halted);
  else v.speed = 0; // no driver, or waiting to set off
}

/** #107: a ground kind's `onDriver`: its new driver takes the wheel (`takeWheel`), then picks its `goal` and the way there. */
export const setsOff =
  <K extends Ground['kind']>(goal: (m: Match, sq: Squad, s: Soldier, v: VehicleOf<K>) => number): NonNullable<VehicleRules<K>['onDriver']> =>
  (m, sq, s, v, wait) => {
    takeWheel(m, v, wait);
    v.goal = goal(m, sq, s, v);
    v.drive.route = -1;
    pickRoute(m, v);
  };

/** #123: at its driver's think, a ground vehicle heads for `goal`: a new goal is a new way there. */
export function head(m: Match, v: Ground, goal: number) {
  if (goal !== v.goal) v.drive.route = -1;
  v.goal = goal;
  pickRoute(m, v);
}

/**
 * #123: one tick along the drive flow field. The hull steers toward the way ahead by at most its class's turn rate, easing
 * into a small correction (`STEER_EASE`), and its speed moves toward the speed it wants by at most its acceleration (braking
 * `brakeMul` times that). The way ahead is the middle of a few cells down the flow field when a straight line to it stays on
 * open ground no worse than the hull's own (so it neither clips a corner nor cuts a bend off the road), else nearer, else the
 * next cell. It wants the road or open speed of the ground under it, less the sharper the turn ahead, no more than lets it
 * stop at the end of the flow field (`halt`: none at all, for a dismount), and no more than stops short of blocked ground
 * dead ahead. A turn it could not stop out of it does not make yet: it brakes straight on, and turns once slow enough. A step
 * that would still end on blocked ground is not taken: it stops there and keeps turning. Parked once there.
 */
export function step(m: Match, v: Ground, halt: boolean) {
  const t = m.tune;
  const g = m.drive[v.side];
  overCrossing(m, v);
  const f = routeFlow(m, v);
  const left = flowDist(m, driveFlow(m, v.side, v.goal), v); // by the road's field whatever the route: they end on the same cells
  v.parked = left === 0;
  const k = cellIndex(m, v.x, v.y);
  const cost = (k >= 0 && g.cost[k]) || 20;
  const spec = SPECS[v.kind];
  const handling = spec.handling!; // only ground kinds drive here, and SPECS' type gives every ground kind its handling
  const accel = handling.accel(t);
  const [roadMps, openMps] = [spec.roadMps(t), spec.openMps(t)];
  const open = (x: number, y: number) => {
    const c = cellIndex(m, x, y);
    return c >= 0 && g.cost[c]! > 0;
  };
  const clear = (ux: number, uy: number, most: number, dearest?: number) => openRun(m, g, v, ux, uy, most, dearest);
  const seen = (p: Vec2, dearest?: number) => {
    const d = Math.sqrt(dist2(v, p));
    return d < 0.01 || clear((p.x - v.x) / d, (p.y - v.y) / d, d, dearest) >= d;
  };
  /** The way ahead: the middle of the `span` flow cells from `n` on, so it does not hop as the hull crosses a cell. */
  const aim = (n: number, span: number): Vec2 | null => {
    let [x, y] = [0, 0];
    for (let i = 0; i < span; i++) {
      const p = alongPath(m, v, n + i, (q) => seen(q)) ?? flowLook(m, f, v, n + i, g);
      if (!p) return null;
      [x, y] = [x + p.x / span, y + p.y / span];
    }
    return { x, y };
  };
  /** The tick heading (fx, fy) and wanting speed `want`: no faster than stops short of blocked ground dead ahead. `safe`: it lands on open ground and can still stop before any. */
  const move = (fx: number, fy: number, want: number) => {
    const room = clear(fx, fy, (v.speed * v.speed) / (accel * t.brakeMul * BRAKE_RESERVE) + t.cellM);
    const speed = approach(v.speed, Math.min(want, stopSpeed(Math.max(0, room - t.cellM / 2), accel, t.brakeMul, BRAKE_RESERVE) + accel / t.hz), accel, t.brakeMul, t.hz);
    const [x, y] = [v.x + (fx * speed) / t.hz, v.y + (fy * speed) / t.hz];
    const lands = speed === 0 || open(x, y);
    return { speed, fx, fy, x, y, lands, safe: lands && speed * speed <= 2 * accel * t.brakeMul * room };
  };
  /** The tick if the way ahead is `n` flow cells on (past the next cell, only with a clear straight line to it): where the hull points, how fast it goes, where that lands. */
  const attempt = (n: number, span = 1) => {
    const to = aim(n, span);
    const d = to ? Math.sqrt(dist2(v, to)) : 0;
    if (!to || d < 0.01) return move(v.fx, v.fy, 0);
    const way = { x: (to.x - v.x) / d, y: (to.y - v.y) / d };
    if (n > 1 && !seen(to, cost)) return null; // nor over worse ground than it is on: it keeps to the road round a bend
    const dot = v.fx * way.x + v.fy * way.y;
    const soft = dot > 0 && dot < cosDeg(1) ? { x: v.fx + (way.x - v.fx) * STEER_EASE, y: v.fy + (way.y - v.fy) * STEER_EASE } : way; // eased: a correction is steered in over a few ticks, not snapped to (within a degree it is, or it would never quite get there)
    const n2 = Math.sqrt(soft.x * soft.x + soft.y * soft.y);
    const { fx, fy } = turnToward(v.fx, v.fy, soft.x / n2, soft.y / n2, handling.turnDegPerS(t), t.hz);
    if (halt || v.parked) return move(fx, fy, 0);
    const align = Math.max(0, fx * way.x + fy * way.y); // 1 straight on, 0 at a right angle or worse
    const base = cost === 10 ? roadMps : (openMps * 20) / cost;
    return move(fx, fy, Math.min(base * (t.turnSpeedMin + (1 - t.turnSpeedMin) * align), stopSpeed(left, accel, t.brakeMul)));
  };
  const far = attempt(3, AIM_SPAN);
  const mid = far?.safe ? far : attempt(2, 2);
  const near = mid?.safe ? mid : attempt(1)!;
  const on = near.safe ? near : move(v.fx, v.fy, 0); // it cannot turn that way yet: straight on, braking
  const a = near.safe ? near : on.safe && on.speed > 0 ? on : near; // stopped, it turns where it stands
  if (!a.lands) v.drive.path = []; // a detour it can't follow: back to its route
  v.speed = a.lands ? a.speed : 0;
  Object.assign(v, { fx: a.fx, fy: a.fy });
  if (v.speed > 0) Object.assign(v, { x: a.x, y: a.y, movedAt: m.tick });
}

/** How many flow cells the far way ahead is averaged over. */
const AIM_SPAN = 4;
/** The share of the turn still to make that a driver steers in each tick (the class's turn rate caps it). ponytail: per tick, so it rides on `hz`; scale it if the tick rate ever changes. */
const STEER_EASE = 0.15;
