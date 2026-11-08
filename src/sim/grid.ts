import type { Match } from './index';
import { insidePolygon } from './geometry';
import type { MapData, Rect, SideId, Terrain, Tune, Vec2 } from './types';

export const WALL = 1;
export const COVER = 2;
export const WATER = 3;

/** Walk cost of a cell: open ground is 10, a ford 20 (half speed), 0 can't be walked. */
const OPEN = 10;
const FORD = 20;

/** Sight grid over the Play Area's bounding box: one byte per cell, 0 open, WALL, COVER or WATER. */
export interface Grid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
  /** #34: walk cost per cell; 0 outside the Play Area, in walls and in uncrossable water. */
  cost: Uint8Array;
  /** #34: index into map.crossings of the crossing on the cell, -1 = none. */
  crossing: Int8Array;
}

export function buildGrid(map: MapData, cellM: number): Grid {
  const xs = map.playArea.map((p) => p.x);
  const ys = map.playArea.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const cols = Math.ceil((Math.max(...xs) - x0) / cellM);
  const rows = Math.ceil((Math.max(...ys) - y0) / cellM);
  const cells = new Uint8Array(cols * rows);
  if (map.terrain) return terrainGrid(map, map.terrain, { x0, y0, cols, rows, cellM, cells });
  const fill = (rects: Rect[] = [], kind: number) => {
    for (const r of rects) // every cell the box overlaps
      for (let j = Math.max(0, Math.floor((r.y0 - y0) / cellM)); j < Math.min(rows, Math.ceil((r.y1 - y0) / cellM)); j++)
        for (let i = Math.max(0, Math.floor((r.x0 - x0) / cellM)); i < Math.min(cols, Math.ceil((r.x1 - x0) / cellM)); i++)
          cells[j * cols + i] = kind;
  };
  fill(map.cover, COVER);
  fill(map.water, WATER);
  fill(map.walls, WALL);
  const cost = new Uint8Array(cols * rows);
  const crossing = new Int8Array(cols * rows).fill(-1);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const x = x0 + (i + 0.5) * cellM;
      const y = y0 + (j + 0.5) * cellM;
      if (cells[k] === WALL || !insidePolygon(map.playArea, x, y)) continue;
      if (cells[k] !== WATER) {
        cost[k] = OPEN;
        continue;
      }
      const c = (map.crossings ?? []).findIndex((c) => Math.abs(y - c.y) <= Math.max(c.halfWidth, cellM / 2) && Math.abs(x - c.x) <= 30);
      if (c < 0) continue;
      crossing[k] = c;
      cost[k] = map.crossings![c]!.kind === 'ford' ? FORD : OPEN;
    }
  return { x0, y0, cols, rows, cells, cost, crossing };
}

/** #42: the grid read off a baked map's terrain at each cell's centre; a ford is slow, bridges and fords belong to their crossing. */
function terrainGrid(map: MapData, t: Terrain, g: { x0: number; y0: number; cols: number; rows: number; cellM: number; cells: Uint8Array }): Grid {
  const { x0, y0, cols, rows, cellM, cells } = g;
  const cost = new Uint8Array(cols * rows);
  const crossing = new Int8Array(cols * rows).fill(-1);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = x0 + (i + 0.5) * cellM;
      const y = y0 + (j + 0.5) * cellM;
      const ti = Math.floor((x - t.x0) / t.cellM);
      const tj = Math.floor((y - t.y0) / t.cellM);
      if (ti < 0 || tj < 0 || ti >= t.cols || tj >= t.rows) continue;
      const k = j * cols + i;
      const tk = tj * t.cols + ti;
      cells[k] = t.cells[tk]!;
      crossing[k] = t.crossing[tk]!;
      if (cells[k] !== WALL && cells[k] !== WATER && insidePolygon(map.playArea, x, y)) cost[k] = t.wade[tk] ? FORD : OPEN;
    }
  return { x0, y0, cols, rows, cells, cost, crossing };
}

/**
 * #107: `side`'s ground-vehicle grid: the sight grid with the drive cost (road 10, open 20, ford 30; from the baked terrain,
 * or on a hand-written map open 20, a bridge 10, a ford 30 and cover, walls, water and footbridges blocked), every cell within
 * `hullM` of a blocked one blocked too (on a baked map, every such cell off the road), and the enemy HQ circle blocked.
 */
export function driveGrid(map: MapData, g: Grid, side: SideId, t: Tune): Grid {
  const { x0, y0, cols, rows, cells, crossing } = g;
  const base = new Uint8Array(cols * rows);
  const tr = map.terrain;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!g.cost[k]) continue; // a wall, water nobody crosses, or outside the Play Area: blocked for vehicles too
      if (tr) {
        const ti = Math.floor((x0 + (i + 0.5) * t.cellM - tr.x0) / tr.cellM);
        const tj = Math.floor((y0 + (j + 0.5) * t.cellM - tr.y0) / tr.cellM);
        const tk = tj * tr.cols + ti;
        // the hull margin, to the metre, off the road; a road the bake drew takes a tank however close the hedges come
        if (ti >= 0 && tj >= 0 && ti < tr.cols && tj < tr.rows && (tr.clear[tk]! > t.hullM * 10 || tr.drive[tk] === 10)) base[k] = tr.drive[tk]!;
      } else if (cells[k] === 0) base[k] = 20;
      else if (cells[k] === WATER) base[k] = { bridge: 10, ford: 30, footbridge: 0 }[map.crossings![crossing[k]!]!.kind];
    }
  const cost = base.slice();
  const reach = tr ? 0 : Math.floor(t.hullM / t.cellM); // a hand-written map's margin goes by whole cells
  const ring: number[][] = [];
  for (let b = -reach; b <= reach; b++) for (let a = -reach; a <= reach; a++) if ((a * a + b * b) * t.cellM * t.cellM <= t.hullM * t.hullM) ring.push([a, b]);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (base[j * cols + i] || !reach) continue;
      for (const [a, b] of ring) if (i + a! >= 0 && j + b! >= 0 && i + a! < cols && j + b! < rows) cost[(j + b!) * cols + i + a!] = 0;
    }
  const hq = map.hqs[side === 'nato' ? 'pact' : 'nato'];
  const r = hq.radius ?? t.hqRadius;
  for (let j = Math.max(0, Math.floor((hq.y - r - y0) / t.cellM)); j < Math.min(rows, Math.ceil((hq.y + r - y0) / t.cellM)); j++)
    for (let i = Math.max(0, Math.floor((hq.x - r - x0) / t.cellM)); i < Math.min(cols, Math.ceil((hq.x + r - x0) / t.cellM)); i++) {
      const dx = x0 + (i + 0.5) * t.cellM - hq.x;
      const dy = y0 + (j + 0.5) * t.cellM - hq.y;
      if (dx * dx + dy * dy < r * r) cost[j * cols + i] = 0;
    }
  return { ...g, cost };
}

/** Index of the cell holding (x, y), -1 off the grid. */
export function cellIndex(m: Match, x: number, y: number): number {
  const g = m.grid;
  const i = Math.floor((x - g.x0) / m.tune.cellM);
  const j = Math.floor((y - g.y0) / m.tune.cellM);
  return i < 0 || j < 0 || i >= g.cols || j >= g.rows ? -1 : j * g.cols + i;
}

/** Centre of cell `k`. */
export function cellCentre(m: Match, k: number): Vec2 {
  const g = m.grid;
  return { x: g.x0 + ((k % g.cols) + 0.5) * m.tune.cellM, y: g.y0 + (Math.floor(k / g.cols) + 0.5) * m.tune.cellM };
}

export function cellAt(m: Match, x: number, y: number): number {
  const k = cellIndex(m, x, y);
  return k < 0 ? 0 : m.grid.cells[k]!;
}

/** Walk cost at (x, y); 0 = can't walk there. */
export function walkCost(m: Match, x: number, y: number): number {
  const k = cellIndex(m, x, y);
  return k < 0 ? 0 : m.grid.cost[k]!;
}

/** `p` itself when it can be walked on (over `g`: #107 a drive grid), else the centre of the nearest walkable cell (a Capture Point may sit in a building). */
export function nearestWalkable(m: Match, p: Vec2, g: Grid = m.grid): Vec2 {
  const k = cellIndex(m, p.x, p.y);
  if (k >= 0 && g.cost[k]) return p;
  const i0 = Math.floor((p.x - g.x0) / m.tune.cellM);
  const j0 = Math.floor((p.y - g.y0) / m.tune.cellM);
  let best = p;
  let bestD = Infinity;
  for (let r = 1; r < Math.max(g.cols, g.rows) && bestD === Infinity; r++)
    for (let j = j0 - r; j <= j0 + r; j++)
      for (let i = i0 - r; i <= i0 + r; i++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) < r || i < 0 || j < 0 || i >= g.cols || j >= g.rows || !g.cost[j * g.cols + i]) continue;
        const c = cellCentre(m, j * g.cols + i);
        const d = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
        if (d < bestD) (bestD = d), (best = c);
      }
  return best; // shortcut: the first ring with a walkable cell, up to 1.4x farther than the true nearest; fine for a Redeploy spot
}

/** Grid line of sight: samples every half cell between the two, blocked by any wall cell. */
export function los(m: Match, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.ceil(Math.sqrt(dx * dx + dy * dy) / (m.tune.cellM / 2));
  for (let k = 1; k < n; k++) if (cellAt(m, a.x + (dx * k) / n, a.y + (dy * k) / n) === WALL) return false;
  return true;
}

/** Walkable all the way along the straight line, sampled every metre. */
export function lineWalk(m: Match, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.ceil(Math.sqrt(dx * dx + dy * dy));
  for (let k = 1; k <= n; k++) if (!walkCost(m, a.x + (dx * k) / n, a.y + (dy * k) / n)) return false;
  return true;
}
