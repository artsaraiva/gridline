import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../../sim';
import { TEST_FIELD } from '../../maps/test-field';
import { DEFAULT_TUNE } from '../../sim/tune';
import { FEINT_LANDED_FRAME, FEINT_SHEET, FEINT_SWING_FRAMES, feintDrop, feintPulse } from './feint';

describe('Feint dummy', () => {
  const spot = { x: 40, y: 20 };

  it('registers the baked sheet: swing frames, then the falling shadow, then the dummy on the ground', () => {
    expect(FEINT_LANDED_FRAME).toBe(FEINT_SWING_FRAMES + 1);
    expect(FEINT_SHEET.frames).toBe(FEINT_SWING_FRAMES + 2);
  });

  it('comes down north-east of its spot under the canopy, then lies on the spot in its landed frame', () => {
    const high = feintDrop({ ...spot, landsIn: 5, fall: 5 });
    expect(high.landed).toBe(false);
    expect(high.crate.x).toBeGreaterThan(spot.x);
    expect(high.crate.y).toBeGreaterThan(spot.y);
    expect(high.frame).toBeLessThan(FEINT_SWING_FRAMES);
    expect(feintDrop({ ...spot, landsIn: 0, fall: 5 })).toMatchObject({ landed: true, ...spot, frame: FEINT_LANDED_FRAME });
  });

  it('pulses at each burst: a ring that grows from the dummy as it fades, gone well before the next burst', () => {
    expect(feintPulse(undefined)).toBeNull();
    const start = feintPulse(0)!;
    const later = feintPulse(0.6)!;
    expect(start).toEqual({ r: 0, opacity: 1 });
    expect(later.r).toBeGreaterThan(start.r);
    expect(later.opacity).toBeLessThan(start.opacity);
    expect(feintPulse(1.5)).toBeNull();
    expect(feintPulse(1.9)).toBeNull();
  });

  it('follows the Simulation: falling while it is in the air, landed and pulsing every 2 s once it is down', () => {
    const tune = { ...DEFAULT_TUNE, feintCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [{ tick: m.tick, side: 'nato', kind: 'asset', asset: 'feint', at: spot }]);
    const view = () => commanderView(m, 'nato').effects!.find((f) => f.asset === 'feint')!;
    const pose = () => feintDrop({ x: view().x, y: view().y, landsIn: view().landsIn!, fall: view().fall! });
    expect(pose().landed).toBe(false);
    expect(feintPulse(view().burst)).toBeNull();
    for (let i = 0; i < tune.supplyFallSeconds * tune.hz; i++) step(m, []);
    expect(pose()).toMatchObject({ landed: true, ...spot });
    expect(feintPulse(view().burst)).not.toBeNull(); // the landing's burst
    const pulsed = Array.from({ length: 6 * tune.hz }, () => (step(m, []), !!feintPulse(view().burst)));
    const onsets = pulsed.flatMap((p, i) => (i > 0 && p && !pulsed[i - 1] ? [i] : []));
    expect(onsets.slice(1).map((t, k) => t - onsets[k]!)).toEqual([2 * tune.hz, 2 * tune.hz]); // a pulse a burst
  });
});
