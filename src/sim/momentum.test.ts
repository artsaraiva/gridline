import { describe, expect, it } from 'vitest';
import { approach, stopSpeed, turnToward } from './momentum';

const deg = (a: { fx: number; fy: number }, b: { fx: number; fy: number }) => (Math.acos(Math.max(-1, Math.min(1, a.fx * b.fx + a.fy * b.fy))) * 180) / Math.PI;

describe('#123 momentum: a small step any vehicle takes', () => {
  it('speed moves toward the wanted speed by at most accel per second up, accel x brakeMul down', () => {
    expect(approach(0, 9, 4, 2, 20)).toBeCloseTo(0.2);
    expect(approach(9, 0, 4, 2, 20)).toBeCloseTo(8.6);
    expect(approach(0.1, 0, 4, 2, 20)).toBe(0); // lands on the wanted speed instead of crossing it
    expect(approach(5, 5.05, 4, 2, 20)).toBe(5.05);
  });

  it('the speed that still lets it stop in d metres is sqrt(2 x braking x d)', () => {
    expect(stopSpeed(9, 4, 2)).toBeCloseTo(12); // v^2 = 2 * 8 * 9 = 144
    expect(stopSpeed(0, 4, 2)).toBe(0);
  });

  it('turns by the turn rate per tick and no more, either way round, and snaps to a way ahead inside one step', () => {
    const east = { fx: 1, fy: 0 };
    const left = turnToward(east.fx, east.fy, 0, 1, 90, 20); // 4.5 degrees a tick
    expect(deg(east, left)).toBeCloseTo(4.5, 1);
    expect(left.fy).toBeGreaterThan(0);
    expect(turnToward(1, 0, 0, -1, 90, 20).fy).toBeLessThan(0);
    expect(Math.hypot(left.fx, left.fy)).toBeCloseTo(1, 6);
    const near = turnToward(1, 0, Math.SQRT1_2, Math.SQRT1_2, 90 * 20, 20); // a 45 degree step is allowed
    expect(near).toEqual({ fx: Math.SQRT1_2, fy: Math.SQRT1_2 });
  });

  it('turns all the way round when the way ahead is dead behind, and the heading stays a unit vector', () => {
    let h = { fx: 1, fy: 0 };
    let ticks = 0;
    while (deg(h, { fx: -1, fy: 0 }) > 0.001 && ticks < 1000) (h = turnToward(h.fx, h.fy, -1, 0, 45, 20), ticks++);
    expect(ticks).toBeGreaterThanOrEqual(80); // 180 / 2.25
    expect(ticks).toBeLessThanOrEqual(81);
    expect(Math.hypot(h.fx, h.fy)).toBeCloseTo(1, 6);
  });
});
