import { describe, expect, it } from 'vitest';
import { gridCentre, gridRef } from './grid-ref';

// 4 x 3 squares of 100 m centred on the map origin: x -200..200, y -150..150.
const grid = { cols: 4, rows: 3, squareM: 100, letters: 'ABCD' };

describe('Grid Reference', () => {
  it('names columns by letter from the west and rows by number from the north', () => {
    expect(gridRef(grid, { x: -199, y: 149 })).toBe('A1');
    expect(gridRef(grid, { x: 199, y: -149 })).toBe('D3');
    expect(gridRef(grid, { x: 0, y: 0 })).toBe('C2');
    expect(gridRef(grid, { x: -101, y: -51 })).toBe('A3');
  });

  it('gives the nearest edge square for a position on or past the grid edge', () => {
    expect(gridRef(grid, { x: 200, y: -150 })).toBe('D3');
    expect(gridRef(grid, { x: -900, y: 900 })).toBe('A1');
  });
});

describe('Grid Reference centre', () => {
  it('is the middle of the square, and gridRef maps it back', () => {
    expect(gridCentre(grid, 'A1')).toEqual({ x: -150, y: 100 });
    expect(gridCentre(grid, 'D3')).toEqual({ x: 150, y: -100 });
    for (const ref of ['A1', 'B2', 'C3', 'D1']) expect(gridRef(grid, gridCentre(grid, ref)!)).toBe(ref);
  });

  it('is null for a reference off the grid', () => {
    for (const ref of ['', 'E1', 'A0', 'A4', 'Ax', '5']) expect(gridCentre(grid, ref)).toBeNull();
  });
});
