import type { MapGrid, Vec2 } from './types';

/** The Grid Reference ("E5") of the square holding `p`; positions on or past the edge get the nearest edge square. */
export function gridRef(grid: MapGrid, p: Vec2): string {
  const clamp = (n: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(n)));
  const col = clamp(p.x / grid.squareM + grid.cols / 2, grid.cols);
  const row = clamp(grid.rows / 2 - p.y / grid.squareM, grid.rows);
  return `${grid.letters[col]}${row + 1}`;
}
