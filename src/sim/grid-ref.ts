import type { MapGrid, Vec2 } from './types';

/** The Grid Reference ("E5") of the square holding `p`; positions on or past the edge get the nearest edge square. */
export function gridRef(grid: MapGrid, p: Vec2): string {
  const clamp = (n: number, max: number) => Math.min(max - 1, Math.max(0, Math.floor(n)));
  const col = clamp(p.x / grid.squareM + grid.cols / 2, grid.cols);
  const row = clamp(grid.rows / 2 - p.y / grid.squareM, grid.rows);
  return `${grid.letters[col]}${row + 1}`;
}

/** The centre of the square a Grid Reference names, or null when it names none on `grid`. */
export function gridCentre(grid: MapGrid, ref: string): Vec2 | null {
  const col = grid.letters.indexOf(ref[0] ?? '');
  const row = Number(ref.slice(1)) - 1;
  if (col < 0 || !Number.isInteger(row) || row < 0 || row >= grid.rows) return null;
  return { x: (col + 0.5 - grid.cols / 2) * grid.squareM, y: (grid.rows / 2 - row - 0.5) * grid.squareM };
}
