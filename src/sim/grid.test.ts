import { describe, expect, it } from 'vitest';
import { openRun, type Grid } from './grid';
import type { Match } from './index';

// A 4 x 4 grid of 2 m cells from the origin: road (10) everywhere but one field cell (20) and one blocked cell (0).
const cost = new Uint8Array(16).fill(10);
cost[1 * 4 + 2] = 0; // x 4..6, y 2..4
cost[3 * 4 + 0] = 20; // x 0..2, y 6..8
const g = { x0: 0, y0: 0, cols: 4, rows: 4, cost } as Grid;
const m = { tune: { cellM: 2 } } as Match;

describe('openRun', () => {
  it('runs to the first blocked cell the line enters, to the grid\'s edge, or to `most`', () => {
    expect(openRun(m, g, { x: 1, y: 3 }, 1, 0, 20)).toBeCloseTo(3); // into the blocked cell at x = 4
    expect(openRun(m, g, { x: 1, y: 1 }, 1, 0, 20)).toBeCloseTo(7); // past under it, off the grid at x = 8
    expect(openRun(m, g, { x: 1, y: 1 }, 1, 0, 5)).toBe(5);
  });

  it('counts a clipped corner: a line that crosses under a metre of a blocked cell still ends there', () => {
    expect(openRun(m, g, { x: 3.9, y: 1 }, 0.6, 0.8, 20)).toBeCloseTo(1.25); // in at (4.65, 2), out again at (5.4, 3)... had it gone on
  });

  it('ends on ground costlier than `dearest`', () => {
    expect(openRun(m, g, { x: 1, y: 3 }, 0, 1, 20)).toBeCloseTo(5);
    expect(openRun(m, g, { x: 1, y: 3 }, 0, 1, 20, 10)).toBeCloseTo(3); // the field cell from y = 6
  });
});
