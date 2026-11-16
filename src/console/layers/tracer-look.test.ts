import { describe, expect, it } from 'vitest';
import { FLASH_HOT_MS, FLASH_MS, flashAt, flightMs, KICK_MS, landing, puffAt, ROUND_LENGTH_M, ROUND_MPS, roundAt, sparkAt } from './tracer-look';

describe('a shot: a round that flies, a muzzle flash, and what the round kicks up', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 84, y: 0 };

  it('flies the round to its target at a readable speed, a streak behind its head', () => {
    expect(flightMs(from, to)).toBeCloseTo((84 / ROUND_MPS) * 1000);
    expect(roundAt(from, to, 0)).toEqual({ tail: { x: 0, y: 0 }, head: { x: 0, y: 0 } });
    const mid = roundAt(from, to, 100)!;
    expect(mid.head.x).toBeCloseTo(42);
    expect(mid.head.x - mid.tail.x).toBeCloseTo(ROUND_LENGTH_M);
    expect(roundAt(from, to, flightMs(from, to))!.head.x).toBeCloseTo(84);
    expect(roundAt(from, to, flightMs(from, to) + 1)).toBeNull();
  });

  it('flashes hot for a frame, then smaller, its light fading out with it', () => {
    expect(flashAt(0)).toEqual({ size: 1, light: 1 });
    expect(flashAt(FLASH_HOT_MS)!.size).toBeLessThan(1);
    expect(flashAt(FLASH_MS - 1)!.light).toBeLessThan(0.05);
    expect(flashAt(FLASH_MS)).toBeNull();
  });

  it('throws sparks back toward the shooter on a hit', () => {
    const kicks = landing(to, 0, true, 500, () => 0.5);
    expect(kicks).toHaveLength(4);
    for (const k of kicks) {
      expect(k).toMatchObject({ kind: 'spark', x: 84, y: 0, at: 500 });
      expect(Math.cos(k.angle)).toBeLessThan(0);
    }
  });

  it('kicks up dust on a miss, and a ricochet only now and then', () => {
    expect(landing(to, 0, false, 0, () => 0.5).map((k) => k.kind)).toEqual(['dust']);
    expect(landing(to, 0, false, 0, () => 0.1).map((k) => k.kind)).toEqual(['dust', 'ricochet']);
  });

  it('swells and fades a puff, and runs a spark out along its heading', () => {
    const young = puffAt('dust', 50)!;
    const old = puffAt('dust', KICK_MS.dust - 50)!;
    expect(old.radius).toBeGreaterThan(young.radius);
    expect(old.opacity).toBeLessThan(young.opacity);
    expect(puffAt('dust', KICK_MS.dust)).toBeNull();
    const spark = landing(to, 0, true, 0, () => 0.5)[0]!;
    expect(sparkAt(spark, 100)!.head).toBeGreaterThan(sparkAt(spark, 50)!.head);
    expect(sparkAt(spark, KICK_MS.spark)).toBeNull();
  });
});
