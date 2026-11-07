import { describe, expect, it } from 'vitest';
import { scanUav, UAV_EXAGGERATION, UAV_HEADINGS, UAV_SHADOW_FRAME, UAV_SHEET, UAV_WORLD_M } from './scan-uav';

describe('Scan UAV circling its orbit', () => {
  const center = { x: 120, y: 120 };
  const radius = 60;
  const step = (2 * Math.PI) / UAV_HEADINGS;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  it('registers the baked UAV sheet: one frame per baked heading plus a shadow frame', () => {
    expect(UAV_SHADOW_FRAME).toBe(UAV_HEADINGS);
    expect(UAV_SHEET.frames).toBe(UAV_HEADINGS + 1);
  });

  it('flies counter-clockwise on the scan ring, nose along the orbit tangent', () => {
    for (const t of [0, 1.3, 4, 9.7, 30]) {
      const u = scanUav(center, radius, t);
      const rx = u.x - center.x;
      const ry = u.y - center.y;
      expect(Math.hypot(rx, ry)).toBeCloseTo(radius);
      const hx = Math.cos(u.heading);
      const hy = Math.sin(u.heading);
      expect(rx * hx + ry * hy).toBeCloseTo(0); // tangent
      expect(rx * hy - ry * hx).toBeGreaterThan(0); // counter-clockwise
    }
    const a = scanUav(center, radius, 0);
    const b = scanUav(center, radius, 1);
    expect({ x: a.x, y: a.y }).not.toEqual({ x: b.x, y: b.y });
  });

  it('picks the nearest baked heading frame so the baked sun stays in the north-east, and rotates only the remainder', () => {
    for (let t = 0; t < 40; t += 0.37) {
      const u = scanUav(center, radius, t);
      expect(Number.isInteger(u.frame)).toBe(true);
      expect(u.frame).toBeGreaterThanOrEqual(0);
      expect(u.frame).toBeLessThan(UAV_HEADINGS);
      expect(Math.abs(u.rotation)).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(wrap(u.frame * step + u.rotation - u.heading)).toBeCloseTo(0);
    }
  });

  it('draws at world scale with an exaggeration tune value and casts its shadow south-west, turned with the aircraft', () => {
    const u = scanUav(center, radius, 2);
    expect(u.size).toBeCloseTo(UAV_WORLD_M * UAV_EXAGGERATION);
    expect(scanUav(center, radius, 2, UAV_EXAGGERATION * 2).size).toBeCloseTo(u.size * 2);
    expect(u.shadow.x).toBeLessThan(u.x);
    expect(u.shadow.y).toBeLessThan(u.y);
    expect(u.shadow.x - u.x).toBeCloseTo(u.shadow.y - u.y);
    expect(u.shadow.rotation).toBeCloseTo(u.heading);
  });
});
