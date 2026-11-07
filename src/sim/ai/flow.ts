// Flow fields: integer Dijkstra from a goal over the walk cost grid. Soldiers walk downhill on them.
// They depend only on the map, so they are built on first use and cached per grid; they are not Match state.
import type { Match } from '../index';
import type { Grid } from '../grid';
import { cellCentre, cellIndex } from '../grid';
import { dist2 } from '../geometry';
import { SIDES, type SideId, type Vec2 } from '../types';

const DI = [1, 1, 0, -1, -1, -1, 0, 1];
const DJ = [0, 1, 1, 1, 0, -1, -1, -1];
const FAR = 0x3fffffff;

/** Distance-to-goal per cell, in cost units: 10 x cost per straight step, 14 x cost per diagonal one. */
export type Flow = Int32Array;

const cache = new WeakMap<Grid, Map<string, Flow>>();

function cached(g: Grid, key: string, build: () => Flow): Flow {
  let byKey = cache.get(g);
  if (!byKey) cache.set(g, (byKey = new Map()));
  let f = byKey.get(key);
  if (!f) byKey.set(key, (f = build()));
  return f;
}

/** Flow field over `g` to the walkable cells within `r` of `goal`; `closed` cells count as unwalkable. */
function build(m: Match, g: Grid, goal: Vec2, r: number, closed?: (k: number) => boolean): Flow {
  const { cols, rows, cost } = g;
  const walk = (k: number) => cost[k]! > 0 && !closed?.(k);
  const dist = new Int32Array(cols * rows).fill(FAR);
  const hk: number[] = [];
  const hv: number[] = [];
  const push = (key: number, val: number) => {
    let i = hk.length;
    hk.push(key);
    hv.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p]! <= key) break;
      hk[i] = hk[p]!;
      hv[i] = hv[p]!;
      i = p;
    }
    hk[i] = key;
    hv[i] = val;
  };
  for (let k = 0; k < cols * rows; k++) {
    if (!walk(k) || dist2(cellCentre(m, k), goal) >= r * r) continue;
    dist[k] = 0;
    push(0, k);
  }
  while (hk.length) {
    const k = hv[0]!;
    const d = hk[0]!;
    const lk = hk.pop()!;
    const lv = hv.pop()!;
    const n = hk.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && hk[l + 1]! < hk[l]! ? l + 1 : l;
        if (hk[c]! >= lk) break;
        hk[i] = hk[c]!;
        hv[i] = hv[c]!;
        i = c;
      }
      hk[i] = lk;
      hv[i] = lv;
    }
    if (d > dist[k]!) continue;
    const i = k % cols;
    const j = (k / cols) | 0;
    for (let q = 0; q < 8; q++) {
      const ni = i + DI[q]!;
      const nj = j + DJ[q]!;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (!walk(nk)) continue;
      const diag = q & 1;
      if (diag && (!walk(j * cols + ni) || !walk(nj * cols + i))) continue; // no corner cutting
      const nd = d + cost[nk]! * (diag ? 14 : 10);
      if (nd < dist[nk]!) {
        dist[nk] = nd;
        push(nd, nk);
      }
    }
  }
  return dist;
}

/** To Capture Point `i`. */
export const pointFlow = (m: Match, i: number) => {
  const p = m.points[i]!;
  return cached(m.grid, `p${i}`, () => build(m, m.grid, p, Math.max(m.tune.cellM, p.radius - 6)));
};

/** To a Supply Drop crate at `at`. */
export const crateFlow = (m: Match, at: Vec2) => cached(m.grid, `c${at.x},${at.y}`, () => build(m, m.grid, at, m.tune.supplyRadiusM * 0.6));

/** To `side`'s HQ. */
export const hqFlow = (m: Match, side: SideId) => {
  const hq = m.map.hqs[side];
  return cached(m.grid, side, () => build(m, m.grid, hq, (hq.radius ?? m.tune.hqRadius) * 0.6));
};

/** To Capture Point `i` over crossing `c` only: every other crossing is closed. */
export const routeFlow = (m: Match, i: number, c: number) => {
  const p = m.points[i]!;
  const g = m.grid;
  return cached(g, `p${i}x${c}`, () => build(m, g, p, Math.max(m.tune.cellM, p.radius - 6), (k) => g.crossing[k]! >= 0 && g.crossing[k] !== c));
};

/** #107: from anywhere `side`'s vehicles can drive (their slot's ground) to `side`'s slot. */
const slotFlow = (m: Match, side: SideId) => cached(m.drive[side], 'slot', () => build(m, m.drive[side], m.vehicles.find((v) => v.side === side)!.slot, m.tune.cellM));

/**
 * #107: a `side` vehicle's way to Capture Point `i`: to the drivable cells well inside its radius, or, when it can't reach
 * any from its slot, to the drivable cell it can reach nearest the point (it parks there and captures nothing).
 */
export const driveFlow = (m: Match, side: SideId, i: number) => {
  const g = m.drive[side];
  const p = m.points[i]!;
  const inside = cached(g, `p${i}`, () => build(m, g, p, Math.max(m.tune.cellM, p.radius - 2)));
  const home = m.vehicles.find((v) => v.side === side)!.slot;
  if (flowDist(m, inside, home) < Infinity) return inside;
  return cached(g, `n${i}`, () => {
    const reach = slotFlow(m, side);
    let best = cellIndex(m, home.x, home.y);
    for (let k = 0; k < reach.length; k++) if (reach[k]! < FAR && dist2(cellCentre(m, k), p) < dist2(cellCentre(m, best), p)) best = k;
    return build(m, g, cellCentre(m, best), m.tune.cellM / 2);
  });
};

/** Builds every map-derived flow field up front (Capture Points, routes over each crossing, HQs) so no tick pays for one; only Supply Drop crates stay lazy. */
export function warmFlows(m: Match) {
  for (let i = 0; i < m.points.length; i++) {
    pointFlow(m, i);
    for (let c = 0; c < (m.map.crossings?.length ?? 0); c++) routeFlow(m, i, c);
  }
  for (const side of SIDES) {
    hqFlow(m, side);
    for (let i = 0; i < m.points.length; i++) driveFlow(m, side, i);
  }
}

/** Metres along the flow field from `p` to its goal; Infinity when it can't get there. */
export function flowDist(m: Match, f: Flow, p: Vec2): number {
  const k = cellIndex(m, p.x, p.y);
  const d = k < 0 ? FAR : f[k]!;
  return d >= FAR ? Infinity : (d * m.tune.cellM) / 100;
}

/** The point `n` cells downhill from `p` over `g`: where to head next. */
export function flowLook(m: Match, f: Flow, p: Vec2, n: number, g: Grid = m.grid): Vec2 | null {
  const { cols, rows, cost } = g;
  let k = cellIndex(m, p.x, p.y);
  if (k < 0) return null;
  for (let s = 0; s < n; s++) {
    const i = k % cols;
    const j = (k / cols) | 0;
    let best = k;
    for (let q = 0; q < 8; q++) {
      const ni = i + DI[q]!;
      const nj = j + DJ[q]!;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (!cost[nk] || ((q & 1) && (!cost[j * cols + ni] || !cost[nj * cols + i]))) continue;
      if (f[nk]! < f[best]!) best = nk;
    }
    if (best === k) break;
    k = best;
  }
  return cellCentre(m, k);
}
