import { describe, expect, it } from 'vitest';
import { edgeClamp } from './edge-clamp';

describe('edge clamp', () => {
  const inset = { x0: 20, y0: 20, x1: 980, y1: 580 };

  it('leaves a point on screen where it is', () => {
    expect(edgeClamp({ x: 300, y: 200 }, { x: 500, y: 300 }, inset)).toEqual({ x: 300, y: 200, clamped: false });
  });

  it('puts an off-screen point where its line to the target leaves the inset screen', () => {
    const left = edgeClamp({ x: -500, y: 300 }, { x: 500, y: 300 }, inset);
    expect(left).toEqual({ x: 20, y: 300, clamped: true });
    const above = edgeClamp({ x: 500, y: -600 }, { x: 500, y: 300 }, inset);
    expect(above).toEqual({ x: 500, y: 20, clamped: true });
    const corner = edgeClamp({ x: 1500, y: 900 }, { x: 500, y: 300 }, inset);
    expect(corner.clamped).toBe(true);
    expect(corner.x).toBeLessThanOrEqual(980);
    expect(corner.y).toBeLessThanOrEqual(580);
    expect((corner.y - 300) / (corner.x - 500)).toBeCloseTo(0.6); // still on the line
  });

  it('with the target off screen too, clamps to the nearest point of the inset screen', () => {
    expect(edgeClamp({ x: -500, y: -100 }, { x: -400, y: -50 }, inset)).toEqual({ x: 20, y: 20, clamped: true });
  });
});
