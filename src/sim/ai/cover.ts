// Cover: how well a spot shelters from a threat, the best cover spot nearby, and short paths round obstacles to it.
import type { Match } from '../index';
import { canStand, dist2 } from '../geometry';
import { cellAt, cellCentre, cellIndex, COVER, lineWalk, los, WALL } from '../grid';
import type { Soldier } from '../state';
import type { Vec2 } from '../types';
import { flowDist, type Flow } from './flow';

const DI = [1, 1, 0, -1, -1, -1, 0, 1];
const DJ = [0, 1, 1, 1, 0, -1, -1, -1];

/** Octant (0 = east, counter-clockwise) of the direction (dx, dy). */
export function oct(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay <= ax * 0.41421356) return dx >= 0 ? 0 : 4;
  if (ax <= ay * 0.41421356) return dy >= 0 ? 2 : 6;
  return dx >= 0 ? (dy >= 0 ? 1 : 7) : dy >= 0 ? 3 : 5;
}

/** 0 (open) .. 1: shelter at `p` from fire coming from `threat`. A cover cell, or a wall on the threat's side. */
export function shelter(m: Match, p: Vec2, threat: Vec2): number {
  if (cellAt(m, p.x, p.y) === COVER) return 1 - m.tune.coverHitMul;
  const o = oct(threat.x - p.x, threat.y - p.y);
  const wall = (q: number) => cellAt(m, p.x + DI[q & 7]! * m.tune.cellM, p.y + DJ[q & 7]! * m.tune.cellM) === WALL;
  return wall(o) ? 0.6 : wall(o + 1) || wall(o + 7) ? 0.4 : 0;
}

export interface CoverSearch {
  at: Vec2; // centre of the search
  radius: number;
  threat?: Vec2;
  /** Stay within `leash` of `around`; spots well inside `inside` of it score higher. */
  leash?: { around: Vec2; r: number; inside: number };
  /** Spots must make at least `min` metres of progress along `flow`. */
  progress?: { flow: Flow; min: number };
  /** Swing round the threat on side `sign` (+1 left), away from the bearing of `from`. */
  flank?: { from: Vec2; sign: number };
}

/** The best spot to take cover at, with the path to it, or null. Keeps `coverSpacingM` from squad mates' spots. */
export function pickCover(m: Match, s: Soldier, mates: Soldier[], o: CoverSearch): { at: Vec2; path: Vec2[] } | null {
  const t = m.tune;
  const g = m.grid;
  const R = Math.ceil(o.radius / t.cellM);
  const k0 = cellIndex(m, o.at.x, o.at.y);
  if (k0 < 0) return null;
  const i0 = k0 % g.cols;
  const j0 = (k0 / g.cols) | 0;
  const taken = mates.filter((q) => q !== s && q.state === 'alive').map((q) => q.cover ?? q.dest ?? q);
  const here = o.progress ? flowDist(m, o.progress.flow, s) : 0;
  const found: [number, Vec2][] = [];
  for (let dj = -R; dj <= R; dj++)
    for (let di = -R; di <= R; di++) {
      const i = i0 + di;
      const j = j0 + dj;
      if (di * di + dj * dj > R * R || i < 0 || j < 0 || i >= g.cols || j >= g.rows) continue;
      const k = j * g.cols + i;
      if (!g.cost[k] || g.crossing[k]! >= 0) continue;
      const p = cellCentre(m, k);
      if (!canStand(m, s, p)) continue;
      let dc = 0;
      if (o.leash) {
        dc = Math.sqrt(dist2(p, o.leash.around));
        if (dc > o.leash.r) continue;
      }
      if (taken.some((q) => dist2(q, p) < t.coverSpacingM * t.coverSpacingM)) continue;
      let sc = 0;
      if (o.progress) {
        const prog = here - flowDist(m, o.progress.flow, p);
        if (!(prog >= o.progress.min)) continue;
        sc += Math.min(prog, 14) * 0.09;
      }
      sc += o.threat ? shelter(m, p, o.threat) * 2 : cellAt(m, p.x, p.y) === COVER ? 0.4 : 0;
      if (o.leash && dc < o.leash.inside) sc += 0.9;
      if (o.flank && o.threat) {
        const th = o.threat;
        const ax = o.flank.from.x - th.x;
        const ay = o.flank.from.y - th.y;
        const bx = p.x - th.x;
        const by = p.y - th.y;
        const al = Math.sqrt(ax * ax + ay * ay) || 1;
        const bl = Math.sqrt(bx * bx + by * by) || 1;
        if (bl > Math.sqrt(dist2(s, th)) + 10) continue; // never away from the threat
        const cos = (ax * bx + ay * by) / (al * bl);
        const cross = (ax * by - ay * bx) / (al * bl);
        sc += o.flank.sign * cross > 0 ? (1 - cos) * 1.6 : -0.6;
      }
      sc -= Math.sqrt(dist2(p, s)) * 0.03;
      found.push([sc, p]);
    }
  found.sort((a, b) => b[0] - a[0]);
  let best: { at: Vec2; path: Vec2[] } | null = null;
  let bestScore = -Infinity;
  for (const [sc, p] of found.slice(0, 6)) {
    const path = lineWalk(m, s, p) ? [] : localPath(m, s, p);
    if (!path) continue;
    const v = sc + (o.threat && los(m, p, o.threat) ? 0.5 : 0); // cover you can fight from
    if (v > bestScore) {
      bestScore = v;
      best = { at: p, path };
    }
  }
  return best;
}

/** Breadth-first path from `a` to `b` inside a small window round both, as every third waypoint; null if none. */
export function localPath(m: Match, a: Vec2, b: Vec2): Vec2[] | null {
  const g = m.grid;
  const ka = cellIndex(m, a.x, a.y);
  const kb = cellIndex(m, b.x, b.y);
  if (ka < 0 || kb < 0) return null;
  const [ia, ja, ib, jb] = [ka % g.cols, (ka / g.cols) | 0, kb % g.cols, (kb / g.cols) | 0];
  const M = 10;
  const x0 = Math.max(0, Math.min(ia, ib) - M);
  const y0 = Math.max(0, Math.min(ja, jb) - M);
  const w = Math.min(g.cols - 1, Math.max(ia, ib) + M) - x0 + 1;
  const h = Math.min(g.rows - 1, Math.max(ja, jb) + M) - y0 + 1;
  if (w * h > 4000) return null;
  const walk = (li: number, lj: number) => g.cost[(lj + y0) * g.cols + li + x0]! > 0;
  const prev = new Int32Array(w * h).fill(-1);
  const start = (ja - y0) * w + (ia - x0);
  const goal = (jb - y0) * w + (ib - x0);
  const queue = [start];
  prev[start] = start;
  for (let qi = 0; qi < queue.length && prev[goal]! < 0; qi++) {
    const cur = queue[qi]!;
    const li = cur % w;
    const lj = (cur / w) | 0;
    for (let q = 0; q < 8; q++) {
      const ni = li + DI[q]!;
      const nj = lj + DJ[q]!;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nl = nj * w + ni;
      if (prev[nl]! >= 0 || !walk(ni, nj) || ((q & 1) && (!walk(ni, lj) || !walk(li, nj)))) continue;
      prev[nl] = cur;
      queue.push(nl);
    }
  }
  if (prev[goal]! < 0) return null;
  const path: Vec2[] = [];
  for (let cur = goal; cur !== prev[cur]; cur = prev[cur]!) path.push(cellCentre(m, (Math.floor(cur / w) + y0) * g.cols + (cur % w) + x0));
  path.reverse();
  path[path.length - 1] = b;
  return path.filter((_, n) => n % 3 === 2 || n === path.length - 1);
}
