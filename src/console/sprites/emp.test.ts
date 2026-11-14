import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../../sim';
import { DEFAULT_TUNE } from '../../sim/tune';
import type { EffectView, MapData } from '../../sim/types';
import { CRUISE_ALTITUDE_M } from './missile';
import { crackle, EMP_HEADINGS, EMP_SHADOW_FRAME, EMP_SHEET, empFlash, empInFlight, empRing, empsInFlight, FLASH_SECONDS } from './emp';

const flying = (o: Partial<EffectView> = {}) => ({ asset: 'emp' as const, x: 0, y: 0, radius: 60, left: 15, total: 19, side: 'nato' as const, from: { x: -400, y: 0 }, flight: 0.5, impactIn: 3, ...o });

describe('EMP Strike missile', () => {
  it('registers the baked sheet: a row of headings a Faction, then the shadow', () => {
    expect(EMP_SHADOW_FRAME).toBe(2 * EMP_HEADINGS);
    expect(EMP_SHEET.frames).toBe(2 * EMP_HEADINGS + 1);
  });

  it('flies level along its line from the HQ, at the nearest baked heading of its Faction\'s row, its contrail behind it', () => {
    const p = empInFlight(flying());
    expect(p.shadow).toMatchObject({ x: -200, y: 0, rotation: 0 }); // halfway, on the ground under it
    expect(p.x).toBeGreaterThan(-200); // lifted north-east by its altitude: it bursts in the air, it never comes down
    expect(p.y).toBeGreaterThan(0);
    expect(p.frame).toBe(0); // nato, heading east
    expect(empInFlight(flying({ side: 'pact', from: { x: 0, y: -400 } })).frame).toBe(EMP_HEADINGS + 4); // pact, heading north
    expect(p.trail.head.x).toBeGreaterThan(p.trail.tail.x);
    expect(Math.hypot(p.trail.head.x - p.trail.tail.x, p.trail.head.y - p.trail.tail.y)).toBeCloseTo(90);
  });

  it('is in the air until it bursts, the enemy\'s included; then the flash takes over', () => {
    expect(empsInFlight([flying(), flying({ side: 'pact' })])).toHaveLength(2);
    expect(empsInFlight([flying({ flight: 1, impactIn: 0, burst: 0.05 })])).toEqual([]);
  });
});

describe('EMP Strike burst', () => {
  it('flashes as wide as its ring, then collapses to nothing as it fades within half a second', () => {
    expect(empFlash(0, 60)).toEqual({ r: 60, opacity: 1 });
    const mid = empFlash(FLASH_SECONDS / 2, 60)!;
    expect(mid.r).toBeLessThan(60);
    expect(mid.r).toBeGreaterThan(30); // slowly at first, then fast
    expect(mid.opacity).toBeCloseTo(0.5);
    expect(empFlash(FLASH_SECONDS, 60)).toBeNull();
  });

  it('leaves its ring faint while it holds, fading out at the end', () => {
    expect(empRing(10)).toBeGreaterThan(0);
    expect(empRing(10)).toBeLessThan(0.5);
    expect(empRing(0.5)).toBeLessThan(empRing(10));
    expect(empRing(0)).toBe(0);
  });

  it('crackles on a held vehicle: short jagged sparks inside its hull that jump about, still between redraws', () => {
    const at = { x: 100, y: 50 };
    const now = crackle(7, at, 19, 3.0);
    expect(now).toHaveLength(3);
    for (const spark of now) {
      expect(spark).toHaveLength(3);
      for (const p of spark) expect(Math.hypot(p.x - at.x, p.y - at.y)).toBeLessThanOrEqual(19 * 0.2 + 1e-9);
    }
    expect(crackle(7, at, 19, 3.01)).toEqual(now);
    expect(crackle(7, at, 19, 3.2)).not.toEqual(now);
    expect(crackle(8, at, 19, 3.0)).not.toEqual(now); // each vehicle its own
  });

  it('follows the Simulation: in the air from the HQ, then the burst over the spot', () => {
    const field: MapData = {
      name: 'field',
      playArea: [{ x: -456, y: -456 }, { x: 456, y: -456 }, { x: 456, y: 456 }, { x: -456, y: 456 }],
      hqs: { nato: { x: -415, y: 0 }, pact: { x: 415, y: 0 } },
      points: [{ id: 'C', name: 'C', x: 0, y: 0 }],
    };
    const tune = { ...DEFAULT_TUNE, empCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: field, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [{ tick: m.tick, side: 'nato', kind: 'asset', asset: 'emp', at: { x: 0, y: 0 } }]);
    const fx = () => commanderView(m, 'pact').effects!.find((f) => f.asset === 'emp')!;
    expect(empsInFlight([fx()])[0]!.shadow.x).toBeCloseTo(-415 + 60 / tune.hz, 1);
    for (let i = 0; i < (415 / 60) * tune.hz; i++) step(m, []);
    expect(empsInFlight([fx()])).toEqual([]);
    expect(empFlash(fx().burst!, fx().radius)).not.toBeNull();
    expect(CRUISE_ALTITUDE_M).toBeGreaterThan(0);
  });
});
