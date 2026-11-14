// Flow fields: integer Dijkstra from a goal over the walk cost grid. Soldiers walk downhill on them.
// They depend only on the map, so they are built on first use and cached per grid; they are not Match state.
import type { Match } from '../index';
import type { Grid } from '../grid';
import { cellCentre, cellIndex, nearestWalkable } from '../grid';
import { dist2 } from '../geometry';
import { SIDES, type SideId, type Vec2 } from '../types';

const DI = [1, 1, 0, -1, -1, -1, 0, 1];
const DJ = [0, 1, 1, 1, 0, -1, -1, -1];
const FAR = 0x3fffffff;
/** #151: raw cost units per stored unit. A straight step costs at least 100 raw, so neighbours never round to the same value; ÷16 keeps a 2.5 km map's longest drive inside 16 bits. */
const SCALE = 16;
/** #151: a cell the goal can't be reached from. */
const NONE = 0xffff;

/** Distance-to-goal per cell, in cost units ÷ SCALE: 10 x cost per straight step, 14 x cost per diagonal one. NONE = can't get there. */
export type Flow = Uint16Array;

/** #151: Dijkstra runs exactly in one shared buffer, then rounds into the Flow; only the Flows are kept. */
let scratch = new Int32Array(0);
let openScratch = new Uint8Array(0);
/** #151: the bucket queue's ring, one bucket per cost unit, longer than the longest step (14 x the costliest cell); empty between builds. */
const ring = 14 * 255 + 1;
const buckets: number[][] = Array.from({ length: ring }, () => []);

const cache = new WeakMap<Grid, Map<string, Flow>>();

function cached(g: Grid, key: string, build: () => Flow): Flow {
  let byKey = cache.get(g);
  if (!byKey) cache.set(g, (byKey = new Map()));
  let f = byKey.get(key);
  if (!f) byKey.set(key, (f = build()));
  return f;
}

/**
 * Flow field over `g` to the walkable cells within `r` of `goal`; `closed` cells count as unwalkable. Exported for tests.
 * #151: Dijkstra on a bucket queue (Dial's): step costs are small integers, so a ring of buckets one longest step round replaces
 * the heap. With `bank` (the grid's banks) the goal's own bank is walked with every crossing closed, and the way goes on over the
 * decks to the far side but never from the far side back onto a deck. So it crosses the water at most once, and from any deck it
 * goes on to the goal's bank: a route over a crossing is that crossing's field and then this one.
 * #156: with `reachM`, the search stops that far along the walk from the goal; the cells beyond can't get there.
 */
export function build(m: Match, g: Grid, goal: Vec2, r: number, closed?: (k: number) => boolean, bank?: Int32Array, reachM?: number): Flow {
  const { cols, rows, cost } = g;
  if (scratch.length !== cols * rows) [scratch, openScratch] = [new Int32Array(cols * rows), new Uint8Array(cols * rows)];
  let open: Uint8Array = cost; // walkable: cost > 0
  if (closed) {
    open = openScratch;
    for (let k = 0; k < open.length; k++) open[k] = cost[k]! > 0 && !closed(k) ? 1 : 0;
  }
  const dist = scratch.fill(FAR);
  let queued = 0;
  const goalBanks: number[] = [];
  const c = m.tune.cellM;
  for (let j = Math.max(0, Math.floor((goal.y - r - g.y0) / c)); j < Math.min(rows, Math.ceil((goal.y + r - g.y0) / c)); j++)
    for (let i = Math.max(0, Math.floor((goal.x - r - g.x0) / c)); i < Math.min(cols, Math.ceil((goal.x + r - g.x0) / c)); i++) {
      const k = j * cols + i;
      if (!open[k] || dist2(cellCentre(m, k), goal) >= r * r) continue;
      dist[k] = 0;
      buckets[0]!.push(k);
      queued++;
      if (bank && bank[k]! >= 0 && !goalBanks.includes(bank[k]!)) goalBanks.push(bank[k]!);
    }
  const side = (k: number) => (bank![k]! < 0 ? 1 : goalBanks.includes(bank![k]!) ? 0 : 2); // 0 the goal's bank, 1 a deck, 2 the far side
  const last = reachM === undefined ? FAR - 1 : Math.floor((reachM * 100) / c); // #156: the farthest cost kept; open ground costs 100 a cell of c metres
  for (let d = 0; queued && d <= last; d++) {
    const bucket = buckets[d % ring]!;
    while (bucket.length) {
      const k = bucket.pop()!;
      queued--;
      if (dist[k] !== d) continue; // since lowered
      const from = bank ? side(k) : 0;
      const i = k % cols;
      const j = (k / cols) | 0;
      const edge = i === 0 || j === 0 || i === cols - 1 || j === rows - 1;
      for (let q = 0; q < 8; q++) {
        if (edge && (i + DI[q]! < 0 || j + DJ[q]! < 0 || i + DI[q]! >= cols || j + DJ[q]! >= rows)) continue;
        const nk = k + DI[q]! + DJ[q]! * cols;
        if (!open[nk]) continue;
        const diag = q & 1;
        if (diag && (!open[k + DI[q]!] || !open[k + DJ[q]! * cols])) continue; // no corner cutting
        if (bank && from) {
          const to = side(nk);
          if (to === 0 || (to === 1 && from === 2)) continue; // nothing comes back to the goal's bank, nor onto a deck from the far side
        }
        const nd = d + cost[nk]! * (diag ? 14 : 10);
        if (nd < dist[nk]!) {
          dist[nk] = nd;
          buckets[nd % ring]!.push(nk);
          queued++;
        }
      }
    }
  }
  if (queued) for (const b of buckets) b.length = 0; // #156: stopped at its reach, with cells still queued past it
  const out = new Uint16Array(cols * rows).fill(NONE);
  for (let k = 0; k < out.length; k++) {
    if (dist[k]! > last) continue; // never reached (FAR), or past the reach
    const q = ((dist[k]! + SCALE / 2) / SCALE) | 0; // rounded
    if (q >= NONE) throw new Error(`flow field too long for 16 bits: ${dist[k]} cost units at cell ${k}`); // a clamp would leave Soldiers stuck on a flat far from the goal
    out[k] = q;
  }
  return out;
}

/** To Capture Point `i`. */
export const pointFlow = (m: Match, i: number) => {
  const p = m.points[i]!;
  return cached(m.grid, `p${i}`, () => build(m, m.grid, p, Math.max(m.tune.cellM, p.radius - 6), undefined, banks(m)));
};

/**
 * #156: how far along the walk a Supply Drop crate's field reaches: what the fastest Soldier walks in the time the crate stays.
 * A Squad farther off could never get there before it goes, so it is left out, and the build stays inside one tick on Auental.
 */
export const crateReachM = (m: Match) => m.tune.supplyStaySeconds * m.tune.walkSpeed * (1 + m.tune.speedJitter);

/** To a Supply Drop crate at `at`, out to `crateReachM`. #151: building one drops the fields of crates whose effect is over, so a match's drops never pile up. */
export const crateFlow = (m: Match, at: Vec2) =>
  cached(m.grid, `c${at.x},${at.y}`, () => {
    const byKey = cache.get(m.grid)!;
    for (const key of byKey.keys()) if (key[0] === 'c' && !m.assets.effects.some((e) => e.asset === 'supply' && key === `c${e.x},${e.y}`)) byKey.delete(key);
    return build(m, m.grid, at, m.tune.supplyRadiusM * 0.6, undefined, undefined, crateReachM(m));
  });

/** To `side`'s HQ. */
export const hqFlow = (m: Match, side: SideId) => {
  const hq = m.map.hqs[side];
  return cached(m.grid, side, () => build(m, m.grid, hq, (hq.radius ?? m.tune.hqRadius) * 0.6));
};

/**
 * #151: to the middle of crossing `c`'s deck (its cells within a cell of its anchor), with every other crossing closed so the
 * way there never crosses elsewhere and comes back along the far bank. A route over `c` walks this, then the point's own field.
 */
export const crossingFlow = (m: Match, c: number) => {
  const g = m.grid;
  return cached(g, `x${c}`, () => build(m, g, m.map.crossings![c]!, m.tune.cellM, (k) => g.crossing[k]! >= 0 && g.crossing[k] !== c));
};

/** #107: where `side`'s vehicles start: its first HQ slot (#108: never a Capture Point's), else the drivable cell nearest its HQ. */
const homeOf = (m: Match, side: SideId) => m.vehicles.find((v) => v.side === side && v.point < 0)?.slot ?? nearestWalkable(m, m.map.hqs[side], m.drive[side]);

/** #107: from anywhere `side`'s vehicles can drive (their slot's ground) to `side`'s slot. #151: not cached; it only finds a fallback goal. */
const slotFlow = (m: Match, side: SideId) => build(m, m.drive[side], homeOf(m, side), m.tune.cellM);

/**
 * #107: a `side` vehicle's way to Capture Point `i`: to the drivable cells well inside its radius, or, when it can't reach
 * any from its slot, to the drivable cell it can reach nearest the point (it parks there and captures nothing).
 */
export const driveFlow = (m: Match, side: SideId, i: number) => {
  const g = m.drive[side];
  const p = m.points[i]!;
  const inside = cached(g, `p${i}`, () => build(m, g, p, Math.max(m.tune.cellM, p.radius - 2)));
  const home = homeOf(m, side);
  if (flowDist(m, inside, home) < Infinity) return inside;
  return cached(g, `n${i}`, () => {
    const reach = slotFlow(m, side);
    let best = cellIndex(m, home.x, home.y);
    for (let k = 0; k < reach.length; k++) if (reach[k]! < NONE && dist2(cellCentre(m, k), p) < dist2(cellCentre(m, best), p)) best = k;
    return build(m, g, cellCentre(m, best), m.tune.cellM / 2);
  });
};

/** A `side` vehicle's way to the middle of crossing `c`'s deck with every other crossing closed (`crossingFlow` on its drive grid); built on first use. */
export const crossingDriveFlow = (m: Match, side: SideId, c: number) => {
  const g = m.drive[side];
  return cached(g, `x${c}`, () => build(m, g, m.map.crossings![c]!, 2 * m.tune.cellM, (k) => g.crossing[k]! >= 0 && g.crossing[k] !== c));
};

/** Builds every map-derived flow field up front (Capture Points, crossings, HQs, drives) so no tick pays for one; only Supply Drop crates stay lazy. */
export function warmFlows(m: Match) {
  for (let i = 0; i < m.points.length; i++) pointFlow(m, i);
  for (let c = 0; c < (m.map.crossings?.length ?? 0); c++) crossingFlow(m, c);
  for (const side of SIDES) {
    hqFlow(m, side);
    if (m.vehicles.length) for (let i = 0; i < m.points.length; i++) driveFlow(m, side, i);
  }
}

/** Metres along the flow field from `p` to its goal; Infinity when it can't get there. */
export function flowDist(m: Match, f: Flow, p: Vec2): number {
  const k = cellIndex(m, p.x, p.y);
  const d = k < 0 ? NONE : f[k]!;
  return d >= NONE ? Infinity : (d * SCALE * m.tune.cellM) / 100;
}

/** #151: bytes the flow fields cached for `m`'s grids take, with the build buffers and the banks; what `pnpm bench` reports. */
export function flowBytes(m: Match): number {
  let n = scratch.byteLength + openScratch.byteLength + (bankCache.get(m.grid)?.byteLength ?? 0);
  for (const g of [m.grid, ...SIDES.map((s) => m.drive[s])]) for (const f of cache.get(g)?.values() ?? []) n += f.byteLength;
  return n;
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

const bankCache = new WeakMap<Grid, Int32Array>();

/** #151: per cell, which piece of ground it is on with every crossing closed (a bank, or a walled-in yard); -1 on a crossing or off the ground. */
function banks(m: Match): Int32Array {
  const g = m.grid;
  let b = bankCache.get(g);
  if (b) return b;
  const { cols, rows, cost, crossing } = g;
  const walk = (k: number) => cost[k]! > 0 && crossing[k]! < 0;
  b = new Int32Array(cols * rows).fill(-1);
  const stack: number[] = [];
  for (let s = 0, id = 0; s < b.length; s++) {
    if (b[s] !== -1 || !walk(s)) continue;
    b[s] = id;
    stack.push(s);
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % cols;
      const j = (k / cols) | 0;
      for (let q = 0; q < 8; q++) {
        const ni = i + DI[q]!;
        const nj = j + DJ[q]!;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = nj * cols + ni;
        if (b[nk] !== -1 || !walk(nk) || ((q & 1) && (!walk(j * cols + ni) || !walk(nj * cols + i)))) continue; // the steps `build` takes
        b[nk] = id;
        stack.push(nk);
      }
    }
    id++;
  }
  bankCache.set(g, b);
  return b;
}

/**
 * #151: whether Capture Point `i` is across the water from `p`: none of the ground it is taken from lies on `p`'s with every
 * crossing closed. On a crossing's deck it is on neither bank, so never across (as with every crossing closed: no route).
 */
export function across(m: Match, i: number, p: Vec2): boolean {
  const b = banks(m);
  const k = cellIndex(m, p.x, p.y);
  const own = k < 0 ? -1 : b[k]!;
  if (own < 0) return false;
  const f = pointFlow(m, i);
  const pt = m.points[i]!;
  const g = m.grid;
  const c = m.tune.cellM;
  for (let j = Math.max(0, Math.floor((pt.y - pt.radius - g.y0) / c)); j < Math.min(g.rows, Math.ceil((pt.y + pt.radius - g.y0) / c)); j++)
    for (let ii = Math.max(0, Math.floor((pt.x - pt.radius - g.x0) / c)); ii < Math.min(g.cols, Math.ceil((pt.x + pt.radius - g.x0) / c)); ii++)
      if (f[j * g.cols + ii] === 0 && b[j * g.cols + ii] === own) return false; // one of its goal cells
  return true;
}
