import { describe, expect, it } from 'vitest';
import type { VehicleView } from '../../sim/types';
import { JEEP_EXAGGERATION, JEEP_HEADINGS, JEEP_SHEET, JEEP_WORLD_M, jeepPose } from './jeep';

const STEP = (2 * Math.PI) / JEEP_HEADINGS;
const jeep = (o: Partial<VehicleView> = {}): VehicleView => ({ id: 9, side: 'nato', kind: 'jeep', x: 10, y: -4, fx: 1, fy: 0, tx: 1, ty: 0, ...o });

describe('jeep pose', () => {
  it('draws from its Faction\'s row at the nearest baked heading: nato, then pact', () => {
    expect(jeepPose(jeep())).toEqual({ x: 10, y: -4, size: JEEP_WORLD_M * JEEP_EXAGGERATION, body: { frame: 0, rotation: 0 }, shadow: { frame: JEEP_SHEET.frames - 1, rotation: 0 } });
    expect(jeepPose(jeep({ side: 'pact', fx: 0, fy: -1 })).body.frame).toBe(JEEP_HEADINGS + 12);
  });

  it('keeps the baked sun north-east: only the remainder of the heading turns the sprite, the shadow turns by the whole of it', () => {
    const a = 0.3; // between baked headings 0 (0) and 1 (0.39)
    const p = jeepPose(jeep({ fx: Math.cos(a), fy: Math.sin(a) }));
    expect(p.body.frame).toBe(1);
    expect(p.body.rotation).toBeCloseTo(a - STEP);
    expect(p.shadow).toEqual({ frame: JEEP_SHEET.frames - 1, rotation: expect.closeTo(a) });
  });

  it('draws a Wreck from the wreck row, whatever its Faction', () => {
    expect(jeepPose(jeep({ side: 'pact', wreck: true })).body.frame).toBe(2 * JEEP_HEADINGS);
  });
});
