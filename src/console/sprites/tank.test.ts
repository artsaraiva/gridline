import { describe, expect, it } from 'vitest';
import type { VehicleView } from '../../sim/types';
import { ROUND_STREAK_M, roundStreak, TANK_EXAGGERATION, TANK_HEADINGS, TANK_SHEET, TANK_WORLD_M, vehicleIcon, tankPose } from './tank';

const STEP = (2 * Math.PI) / TANK_HEADINGS;
const tank = (o: Partial<VehicleView> = {}): VehicleView => ({ id: 9, side: 'nato', kind: 'tank', x: 10, y: -4, fx: 1, fy: 0, tx: 1, ty: 0, ...o });

describe('tank pose', () => {
  it('draws hull and turret from their own rows of the Faction: hull row then turret row, at the nearest baked heading', () => {
    // facing east, turret laid north
    const p = tankPose(tank({ tx: 0, ty: 1 }));
    expect(p.hull).toEqual({ frame: 0, rotation: 0 });
    expect(p.turret.frame).toBe(TANK_HEADINGS + 4);
    expect(p.turret.rotation).toBeCloseTo(0);
    expect(p).toMatchObject({ x: 10, y: -4, size: TANK_WORLD_M * TANK_EXAGGERATION });
    // the pact rows follow nato's; facing west
    const pact = tankPose(tank({ side: 'pact', fx: -1, fy: 0, tx: -1, ty: 0 }));
    expect(pact.hull.frame).toBe(2 * TANK_HEADINGS + 8);
    expect(pact.turret.frame).toBe(3 * TANK_HEADINGS + 8);
  });

  it('keeps the baked sun north-east: only the remainder of the heading turns the sprite, the shadows turn by the whole of it', () => {
    const a = 0.3; // between baked headings 0 (0) and 1 (0.39)
    const p = tankPose(tank({ fx: Math.cos(a), fy: Math.sin(a), tx: Math.cos(-a), ty: Math.sin(-a) }));
    expect(p.hull.frame).toBe(1);
    expect(p.hull.rotation).toBeCloseTo(a - STEP);
    expect(p.turret.frame).toBe(TANK_HEADINGS + TANK_HEADINGS - 1);
    expect(p.turret.rotation).toBeCloseTo(-a + STEP);
    expect(p.shadow.hull).toEqual({ frame: TANK_SHEET.frames - 2, rotation: expect.closeTo(a) });
    expect(p.shadow.turret).toEqual({ frame: TANK_SHEET.frames - 1, rotation: expect.closeTo(-a) });
  });

  it('draws a Wreck from the wreck rows, whatever its Faction', () => {
    const p = tankPose(tank({ side: 'pact', wreck: true }));
    expect(p.hull.frame).toBe(4 * TANK_HEADINGS);
    expect(p.turret.frame).toBe(5 * TANK_HEADINGS);
  });

  it('marks a tank with a tactical icon in its Side\'s colour, grey-white while nobody is aboard, none on a Wreck', () => {
    expect(vehicleIcon(tank(), 'nato')).toBe('friendly');
    expect(vehicleIcon(tank({ side: 'pact' }), 'nato')).toBe('hostile');
    expect(vehicleIcon(tank({ empty: true }), 'nato')).toBe('empty');
    expect(vehicleIcon(tank({ side: 'pact', empty: true }), 'nato')).toBe('empty');
    expect(vehicleIcon(tank({ wreck: true }), 'nato')).toBeNull();
  });

  it('lights its icon amber while a Squad with anyone aboard is selected, driver or passenger', () => {
    const own = tank({ seats: [4, 9] });
    expect(vehicleIcon(own, 'nato', [4, 5, 6, 7])).toBe('selected');
    expect(vehicleIcon(own, 'nato', [8, 9, 10, 11])).toBe('selected');
    expect(vehicleIcon(own, 'nato', [0, 1, 2, 3])).toBe('friendly');
    expect(vehicleIcon(tank({ side: 'pact' }), 'nato', [4])).toBe('hostile'); // an enemy tank shows no seats
  });

  it('draws a main gun round as a short streak at its point along the flight, never reaching back past the muzzle', () => {
    const r = { from: { x: 0, y: 0 }, to: { x: 140, y: 0 }, flight: 0.5 };
    expect(roundStreak(r)).toEqual({ x: 70 - ROUND_STREAK_M / 2, y: 0, length: ROUND_STREAK_M, angle: 0 });
    expect(roundStreak({ ...r, flight: 0.02 })).toMatchObject({ x: expect.closeTo(1.4), length: expect.closeTo(2.8) });
  });
});
