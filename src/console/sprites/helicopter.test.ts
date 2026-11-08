import { describe, expect, it } from 'vitest';
import type { VehicleView } from '../../sim/types';
import { HELI_EXAGGERATION, HELI_HEADINGS, HELI_SHEET, HELI_WORLD_M, climb, helicopterPose } from './helicopter';

const STEP = (2 * Math.PI) / HELI_HEADINGS;
const [SHADOW, ROTOR] = [3 * HELI_HEADINGS, 3 * HELI_HEADINGS + 1];
const heli = (o: Partial<VehicleView> = {}): VehicleView => ({ id: 9, side: 'nato', kind: 'helicopter', x: 10, y: -4, fx: 1, fy: 0, tx: 1, ty: 0, ...o });

describe('helicopter pose', () => {
  it('on the ground: flat over its shadow, its Faction\'s row at the nearest baked heading, the rotor standing still when nobody is aboard', () => {
    expect(HELI_SHEET.frames).toBe(ROTOR + 1);
    const p = helicopterPose(heli({ empty: true }), 0, 3);
    expect(p).toEqual({
      x: 10, y: -4, size: HELI_WORLD_M * HELI_EXAGGERATION,
      body: { frame: 0, rotation: 0 },
      shadow: { x: 10, y: -4, frame: SHADOW, rotation: 0 },
      rotor: { frame: ROTOR, rotation: Math.PI / 4, spinning: false },
    });
    expect(helicopterPose(heli({ side: 'pact', fx: 0, fy: -1, empty: true }), 0, 0).body.frame).toBe(HELI_HEADINGS + 12);
  });

  it('crewed, the rotor turns', () => {
    const a = helicopterPose(heli(), 0, 1).rotor!;
    const b = helicopterPose(heli(), 0, 1.1).rotor!;
    expect(a).toMatchObject({ frame: ROTOR, spinning: true });
    expect(b.rotation).not.toBeCloseTo(a.rotation);
  });

  it('in the air: lifted north-east of its ground shadow by its altitude, as the Cruise Missile', () => {
    const p = helicopterPose(heli({ airborne: true }), 50, 0);
    expect(p.shadow).toMatchObject({ x: 10, y: -4 });
    expect(p.x - 10).toBeCloseTo(20 * Math.SQRT1_2); // 50 m at 0.4 m of lift per metre, along the sun
    expect(p.y + 4).toBeCloseTo(20 * Math.SQRT1_2);
  });

  it('keeps the baked sun north-east: only the remainder of the heading turns the body, the shadow turns by the whole of it', () => {
    const a = 0.3;
    const p = helicopterPose(heli({ fx: Math.cos(a), fy: Math.sin(a) }), 0, 0);
    expect(p.body).toEqual({ frame: 1, rotation: expect.closeTo(a - STEP) });
    expect(p.shadow.rotation).toBeCloseTo(a);
  });

  it('a Wreck: the wreck row, whatever its Faction, and no rotor', () => {
    const p = helicopterPose(heli({ side: 'pact', wreck: true }), 0, 0);
    expect(p.body.frame).toBe(2 * HELI_HEADINGS);
    expect(p.rotor).toBeNull();
  });
});

describe('helicopter climb', () => {
  it('climbs to the missile\'s altitude while airborne and settles to the ground after landing, a few seconds either way', () => {
    expect(climb(0, true, 1)).toBeGreaterThan(0);
    expect(climb(0, true, 1)).toBeLessThan(50);
    expect(climb(49, true, 1)).toBe(50);
    expect(climb(50, false, 1)).toBeLessThan(50);
    expect(climb(1, false, 1)).toBe(0);
    expect(climb(50, true, 1)).toBe(50);
  });
});
