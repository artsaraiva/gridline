import type { Match } from './index';
import type { MapData, Rect, Vec2 } from './types';

export const WALL = 1;
export const COVER = 2;

/** Sight grid over the Play Area's bounding box: one byte per cell, 0 open, WALL or COVER. */
export interface Grid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
}

export function buildGrid(map: MapData, cellM: number): Grid {
  const xs = map.playArea.map((p) => p.x);
  const ys = map.playArea.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const cols = Math.ceil((Math.max(...xs) - x0) / cellM);
  const rows = Math.ceil((Math.max(...ys) - y0) / cellM);
  const cells = new Uint8Array(cols * rows);
  const fill = (rects: Rect[] = [], kind: number) => {
    for (const r of rects) // every cell the box overlaps
      for (let j = Math.max(0, Math.floor((r.y0 - y0) / cellM)); j < Math.min(rows, Math.ceil((r.y1 - y0) / cellM)); j++)
        for (let i = Math.max(0, Math.floor((r.x0 - x0) / cellM)); i < Math.min(cols, Math.ceil((r.x1 - x0) / cellM)); i++)
          cells[j * cols + i] = kind;
  };
  fill(map.cover, COVER);
  fill(map.walls, WALL);
  return { x0, y0, cols, rows, cells };
}

export function cellAt(m: Match, x: number, y: number): number {
  const g = m.grid;
  const i = Math.floor((x - g.x0) / m.tune.cellM);
  const j = Math.floor((y - g.y0) / m.tune.cellM);
  return i < 0 || j < 0 || i >= g.cols || j >= g.rows ? 0 : g.cells[j * g.cols + i]!;
}

/** Grid line of sight: samples every half cell between the two, blocked by any wall cell. */
export function los(m: Match, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.ceil(Math.sqrt(dx * dx + dy * dy) / (m.tune.cellM / 2));
  for (let k = 1; k < n; k++) if (cellAt(m, a.x + (dx * k) / n, a.y + (dy * k) / n) === WALL) return false;
  return true;
}
