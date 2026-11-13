import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../../sim';
import { TEST_FIELD } from '../../maps/test-field';
import { DEFAULT_TUNE } from '../../sim/tune';
import { BEACON_LANDED_FRAME, BEACON_SHEET, BEACON_SWING_FRAMES, beaconDrop, beaconLamp } from './beacon';

describe('Redeploy Beacon crate', () => {
  const spot = { x: 40, y: 20 };

  it('registers the baked sheet: swing frames, then the falling shadow, then the landed case', () => {
    expect(BEACON_LANDED_FRAME).toBe(BEACON_SWING_FRAMES + 1);
    expect(BEACON_SHEET.frames).toBe(BEACON_SWING_FRAMES + 2);
  });

  it('comes down north-east of its spot under the canopy, then sits on the spot in its landed frame', () => {
    const high = beaconDrop({ ...spot, landsIn: 5, fall: 5 });
    expect(high.landed).toBe(false);
    expect(high.crate.x).toBeGreaterThan(spot.x);
    expect(high.crate.y).toBeGreaterThan(spot.y);
    expect(high.frame).toBeLessThan(BEACON_SWING_FRAMES);
    expect(beaconDrop({ ...spot, landsIn: 0, fall: 5 })).toMatchObject({ landed: true, ...spot, frame: BEACON_LANDED_FRAME });
  });

  it('its lamp sits on the mast at the north-east corner of the landed case and blinks: a short flash once a second or so', () => {
    const lamp = beaconLamp(spot, 0);
    expect(lamp.x).toBeGreaterThan(spot.x);
    expect(lamp.y).toBeGreaterThan(spot.y);
    const levels = Array.from({ length: 120 }, (_, i) => beaconLamp(spot, i / 50).on);
    expect(levels[0]).toBe(1); // the cycle opens on the flash
    expect(Math.min(...levels)).toBe(0);
    const lit = levels.filter((v) => v > 0).length / levels.length;
    expect(lit).toBeGreaterThan(0.1);
    expect(lit).toBeLessThan(0.4); // mostly dark
  });

  it('follows the Simulation: falling while the crate is in the air, landed once it is down', () => {
    const tune = { ...DEFAULT_TUNE, beaconCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [{ tick: m.tick, side: 'nato', kind: 'asset', asset: 'beacon', at: spot }]);
    const pose = () => {
      const e = commanderView(m, 'nato').effects!.find((f) => f.asset === 'beacon')!;
      return beaconDrop({ x: e.x, y: e.y, landsIn: e.landsIn!, fall: e.fall! });
    };
    expect(pose().landed).toBe(false);
    for (let i = 0; i < (tune.supplyFallSeconds + 0.5) * tune.hz; i++) step(m, []);
    expect(pose()).toMatchObject({ landed: true, ...spot });
  });
});
