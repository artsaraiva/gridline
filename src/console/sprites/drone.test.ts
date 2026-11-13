import { describe, expect, it } from 'vitest';
import type { EffectView } from '../../sim/types';
import { DRONE_EXAGGERATION, DRONE_HEADINGS, DRONE_SHEET, DRONE_WORLD_M, dronesInFlight } from './drone';
import { downed, levelFlight, lifted } from './level-flight';
import { aloft, CRUISE_ALTITUDE_M } from './missile';

/** nato's drone 100 m out from its HQ at (-400, 0), flying east at a spot at the origin. */
const flying: EffectView = { asset: 'drone', x: 0, y: 0, radius: 15, left: 12, total: 15.3, side: 'nato', from: { x: -400, y: 0 }, flight: 0.25, impactIn: 10, craft: { x: -300, y: 0, fx: 1, fy: 0, turn: 0 } };

describe('level flight', () => {
  it('lifts the body to cruise altitude north-east of its shadow, on its Faction\'s row at the nearest baked heading', () => {
    const east = levelFlight({ x: 10, y: 20, fx: 1, fy: 0 }, 'nato', 16);
    expect(east).toMatchObject({ ...aloft({ x: 10, y: 20 }), frame: 0, rotation: 0, shadow: { x: 10, y: 20, rotation: 0 } });
    expect(levelFlight({ x: 0, y: 0, fx: 0, fy: 1 }, 'pact', 16).frame).toBe(16 + 4);
    expect(levelFlight({ x: 0, y: 0, fx: 0, fy: -1 }, 'nato', 16).frame).toBe(12);
  });

  it('keeps the baked sun north-east: only the remainder of the heading turns the body, the shadow by the whole of it', () => {
    const a = 0.3;
    const p = levelFlight({ x: 0, y: 0, fx: Math.cos(a), fy: Math.sin(a) }, 'nato', 16);
    expect(p.frame).toBe(1);
    expect(p.rotation).toBeCloseTo(a - (2 * Math.PI) / 16);
    expect(Math.abs(p.rotation)).toBeLessThanOrEqual(Math.PI / 16);
    expect(p.shadow.rotation).toBeCloseTo(a);
  });

  it('a shot-down one falls onto its shadow over the first part of its last moments, then fades where it lies', () => {
    expect(downed(2, 2)).toEqual({ height: 1, opacity: 1 });
    expect(downed(1.4, 2).height).toBeCloseTo(0.75); // half the fall's time gone, a quarter of the way down
    expect(downed(0.8, 2)).toEqual({ height: 0, opacity: 1 });
    expect(downed(0.4, 2).opacity).toBeCloseTo(0.5);
    expect(downed(0, 2)).toEqual({ height: 0, opacity: 0 });
    expect(levelFlight({ x: 10, y: 20, fx: 1, fy: 0 }, 'nato', 16, 0)).toMatchObject({ x: 10, y: 20 });
  });
});

describe('drone in flight', () => {
  it('is drawn from its effect: its Faction\'s frame, exaggerated, bound for its spot, the sheet\'s last frame its shadow', () => {
    const [d] = dronesInFlight([flying]);
    expect(d).toMatchObject({ ...aloft({ x: -300, y: 0 }), side: 'nato', frame: 0, size: DRONE_WORLD_M * DRONE_EXAGGERATION, to: { x: 0, y: 0 }, lost: false, opacity: 1 });
    expect(DRONE_SHEET.frames).toBe(2 * DRONE_HEADINGS + 1);
    expect(dronesInFlight([{ ...flying, side: 'pact' }])[0]!.frame).toBe(DRONE_HEADINGS);
  });

  it('trails a short contrail along the path it flew: 90 m behind it at its altitude, never back past the HQ it left', () => {
    const [d] = dronesInFlight([flying]);
    expect(d!.trail.head).toEqual(aloft({ x: -300, y: 0 }));
    expect(d!.trail.tail).toEqual(aloft({ x: -390, y: 0 }));
    const [young] = dronesInFlight([{ ...flying, craft: { ...flying.craft!, x: -370 } }]);
    expect(young!.trail.tail.x).toBeCloseTo(aloft({ x: -400, y: 0 }).x);
  });

  it('comes down on a steady shallow slope over its last 160 m and meets its shadow at the spot, its contrail sloping with it', () => {
    const at = (x: number) => dronesInFlight([{ ...flying, craft: { ...flying.craft!, x } }])[0]!;
    expect(at(-161)).toMatchObject(aloft({ x: -161, y: 0 })); // still level
    expect(at(-80)).toMatchObject(lifted({ x: -80, y: 0 }, CRUISE_ALTITUDE_M / 2));
    expect(at(-40)).toMatchObject(lifted({ x: -40, y: 0 }, CRUISE_ALTITUDE_M / 4));
    expect(at(0)).toMatchObject({ x: 0, y: 0, shadow: { x: 0, y: 0 } });
    const low = at(-40);
    expect(low.trail.head).toEqual(lifted({ x: -40, y: 0 }, CRUISE_ALTITUDE_M / 4));
    expect(low.trail.tail).toEqual(lifted({ x: -130, y: 0 }, (CRUISE_ALTITUDE_M * 130) / 160)); // higher, where it was 90 m back
  });

  it('shot down, it falls where it was hit and fades; one that has hit is not drawn (the impact takes over); nor is another Asset', () => {
    const [d] = dronesInFlight([{ ...flying, lost: true, left: 0.4 }]);
    expect(d).toMatchObject({ x: -300, y: 0, lost: true });
    expect(d!.opacity).toBeCloseTo(0.5);
    expect(d!.trail.head).toEqual(aloft({ x: -300, y: 0 })); // the contrail stays up where it was laid
    const { craft: _, ...hit } = flying;
    const other: EffectView = { ...flying, asset: 'missile' };
    expect(dronesInFlight([hit, other])).toEqual([]);
    expect(dronesInFlight(undefined)).toEqual([]);
  });
});
