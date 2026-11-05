import { describe, expect, it } from 'vitest';
import { boundarySdf, SDF_PER_M } from './boundary';

// A 200 m square around the origin, on a 400 m field at 4 m per pixel.
const SQUARE = [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }];
const RES = 100;
const sdf = boundarySdf(SQUARE, 400, RES);
/** Signed distance in metres (negative inside) at world point (x, y); row 0 is the south edge. */
const at = (x: number, y: number) => (sdf[Math.floor((y + 200) / 4) * RES + Math.floor((x + 200) / 4)]! - 128) / SDF_PER_M;

describe('boundary distance field', () => {
  it('is negative inside the Play Area, positive outside, and counts metres from the edge', () => {
    expect(at(0, 0)).toBeLessThan(-20);
    expect(at(0, 0)).toBeCloseTo(-32, 0); // clamped
    expect(at(150, 0)).toBeGreaterThan(0);
    expect(Math.abs(at(98, 0) + 2)).toBeLessThan(3);
    expect(Math.abs(at(110, 0) - 10)).toBeLessThan(3);
  });

  it('reads north up: row 0 is the south edge', () => {
    expect(at(0, 150)).toBeGreaterThan(0);
    expect(at(0, -150)).toBeGreaterThan(0);
    expect(at(0, 90)).toBeLessThan(0);
  });
});
