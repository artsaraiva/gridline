import { describe, expect, it } from 'vitest';
import { createMatch } from '../sim';
import { build, crossingFlow, flowBytes, flowDist, pointFlow, warmFlows } from '../sim/ai/flow';
import { DEFAULT_TUNE } from '../sim/tune';
import { AUENTAL_FIELD } from './auental-field';

describe('#151: flow fields on a 2.5 km map (the synthetic Auental field)', () => {
  it('builds every field within 16 bits and 160 MB, each crossing and point reachable from both HQs', () => {
    const m = createMatch({ seed: 1, map: AUENTAL_FIELD, tune: DEFAULT_TUNE, squadsPerSide: 8, commanderSide: 'nato' });
    expect(m.vehicles.length).toBeGreaterThan(0); // so the drive fields are built too
    warmFlows(m); // throws on a field too long for 16 bits
    expect(flowBytes(m)).toBeLessThanOrEqual(160e6);
    for (const hq of Object.values(m.map.hqs)) {
      AUENTAL_FIELD.crossings!.forEach((c, i) => expect(flowDist(m, crossingFlow(m, i), hq), c.id).toBeLessThan(Infinity));
      m.points.forEach((p, i) => expect(flowDist(m, pointFlow(m, i), hq), p.id).toBeLessThan(Infinity));
    }
    const { nato, pact } = m.map.hqs;
    expect(flowDist(m, build(m, m.grid, pact, 30, (k) => m.grid.crossing[k]! >= 0), nato), 'every crossing closed').toBe(Infinity); // the river and reservoir leave no way round
  }, 60_000);
});
