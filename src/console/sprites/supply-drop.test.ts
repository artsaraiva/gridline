import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../../sim';
import { TEST_FIELD } from '../../maps/test-field';
import { DEFAULT_TUNE } from '../../sim/tune';
import { SUPPLY_LANDED_FRAME, SUPPLY_SHADOW_FRAME, SUPPLY_SHEET, SUPPLY_SWING_FRAMES, supplyDrop } from './supply-drop';

describe('supply drop under its parachute', () => {
  const spot = { x: -120, y: 120 };
  const fall = 5;
  const at = (landsIn: number) => supplyDrop({ ...spot, landsIn, fall });
  const crateOff = (p: ReturnType<typeof supplyDrop>) => Math.hypot(p.crate.x - spot.x, p.crate.y - spot.y);
  const shadowOff = (p: ReturnType<typeof supplyDrop>) => Math.hypot(p.shadow.crate.x - p.crate.x, p.shadow.crate.y - p.crate.y);

  it('registers the baked sheet: swing frames, then the falling shadow, then the landed crate', () => {
    expect(SUPPLY_SHADOW_FRAME).toBe(SUPPLY_SWING_FRAMES);
    expect(SUPPLY_LANDED_FRAME).toBe(SUPPLY_SWING_FRAMES + 1);
    expect(SUPPLY_SHEET.frames).toBe(SUPPLY_SWING_FRAMES + 2);
  });

  it('comes down toward its spot with its shadow closing in from the south-west, then sits on the spot', () => {
    const high = at(fall);
    const low = at(1);
    const down = at(0);
    expect(high.landed).toBe(false);
    expect(high.altitude).toBeGreaterThan(low.altitude);
    // Higher is drawn north-east of the spot (sun in the NE), and its shadow falls south-west of it.
    expect(high.crate.x).toBeGreaterThan(spot.x);
    expect(high.crate.y).toBeGreaterThan(spot.y);
    expect(high.shadow.crate.x).toBeLessThan(high.crate.x);
    expect(high.shadow.crate.y).toBeLessThan(high.crate.y);
    expect(crateOff(high)).toBeGreaterThan(crateOff(low));
    expect(shadowOff(high)).toBeGreaterThan(shadowOff(low));
    expect(high.size).toBeGreaterThan(low.size);
    expect(high.shadow.opacity).toBeLessThan(low.shadow.opacity);

    expect(down.landed).toBe(true);
    expect(down.frame).toBe(SUPPLY_LANDED_FRAME);
    expect({ x: down.x, y: down.y, altitude: down.altitude }).toEqual({ ...spot, altitude: 0 });
  });

  it('swings under the canopy through the swing frames while falling', () => {
    const frames = new Set<number>();
    for (let t = 0; t < fall; t += 0.1) frames.add(at(fall - t).frame);
    expect([...frames].every((f) => f >= 0 && f < SUPPLY_SWING_FRAMES)).toBe(true);
    expect(frames.size).toBe(SUPPLY_SWING_FRAMES);
  });

  it('follows the Simulation: falling while the crate is in the air, landed once it is down', () => {
    const tune = { ...DEFAULT_TUNE, supplyCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [{ tick: m.tick, side: 'nato', kind: 'asset', asset: 'supply', at: { x: 40, y: 20 } }]);
    const pose = () => {
      const e = commanderView(m, 'nato').effects!.find((f) => f.asset === 'supply')!;
      return supplyDrop({ x: e.x, y: e.y, landsIn: e.landsIn!, fall: e.fall! });
    };
    expect(pose().landed).toBe(false);
    for (let i = 0; i < (tune.supplyFallSeconds + 0.5) * tune.hz; i++) step(m, []);
    expect(pose()).toMatchObject({ landed: true, x: 40, y: 20 });
  });
});
