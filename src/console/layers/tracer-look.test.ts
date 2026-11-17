import { describe, expect, it } from 'vitest';
import { flightMs, KICK_MS, landing, puffAt, ROUND_LENGTH_M, ROUND_MPS, roundAt, roundLength, roundOf, sparkAt } from './tracer-look';

describe('a shot: a round that flies, and what it kicks up', () => {
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

  it('sizes and speeds the round by who fired it', () => {
    expect(roundOf('foot')).toEqual({ size: 0.85, mps: ROUND_MPS });
    expect(roundOf('foot', 'sniper')).toMatchObject({ mps: 1000, vapour: 0.3 });
    expect(roundLength(roundOf('foot', 'smg'))).toBeLessThan(roundLength(roundOf('foot')) / 1.5);
    expect(roundLength(roundOf('foot', 'dmr'))).toBeGreaterThan(roundLength(roundOf('foot')) * 1.5);
    expect(roundOf('jeep').size).toBeGreaterThan(roundOf('tank').size * 1.5); // fat and slow next to the tank's thin, fast machine gun
    expect(roundOf('helicopter').rope).toBe(4);
    expect(roundOf('tank').size).toBeLessThan(roundOf('foot').size); // a tank's machine gun never hides its main gun's round
    expect(roundOf('jet').lands).toBe('burst');
    expect(roundOf('helicopter').mps).toBeGreaterThan(ROUND_MPS * 2);
    expect(roundOf('aa').mps).toBeGreaterThan(roundOf('helicopter').mps);
    expect(roundOf('aa')).toMatchObject({ twin: true, lands: 'flak' });
    expect(roundOf('gunship')).toEqual({ size: 1, mps: ROUND_MPS });
    expect(landing(to, 0, false, 0, () => 0.5, roundOf('aa'), true).map((k) => k.kind)).toEqual(['burst', 'flak']); // flak round a target in the air
    expect(landing(to, 0, false, 0, () => 0.5, roundOf('aa')).map((k) => k.kind)).toEqual(['dust']); // and dust on the ground
    expect(landing(to, 0, false, 0, () => 0.5, roundOf('jet')).map((k) => k.kind)).toEqual(['burst', 'dust']);
    expect(landing(to, 0, false, 0, () => 0.5, roundOf('jeep'))[0]!.scale).toBe(1.8);
    expect(flightMs(from, to, roundOf('aa').mps)).toBeLessThan(flightMs(from, to) / 2);
    expect(roundLength(roundOf('aa'))).toBeGreaterThan(roundLength(roundOf('foot')));
    expect(roundAt(from, to, 50, 12, 840)!.head.x).toBeCloseTo(42);
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
    const young = puffAt(50)!;
    const old = puffAt(KICK_MS.dust - 50)!;
    expect(old.radius).toBeGreaterThan(young.radius);
    expect(old.opacity).toBeLessThan(young.opacity);
    expect(puffAt(KICK_MS.dust)).toBeNull();
    const spark = landing(to, 0, true, 0, () => 0.5)[0]!;
    expect(sparkAt(spark, 100)!.head).toBeGreaterThan(sparkAt(spark, 50)!.head);
    expect(sparkAt(spark, KICK_MS.spark)).toBeNull();
  });
});
