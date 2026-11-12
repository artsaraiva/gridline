import { describe, expect, it } from 'vitest';
import { RIVER_FIELD } from '../../maps/river-field';
import { createMatch } from '../index';
import { DEFAULT_TUNE } from '../tune';
import { crateFlow, flowBytes, warmFlows } from './flow';

describe('#151: crate flow fields', () => {
  it('drops a crate\'s field once its Supply Drop is over', () => {
    const m = createMatch({ seed: 1, map: RIVER_FIELD, tune: DEFAULT_TUNE, squadsPerSide: 1, commanderSide: 'nato' });
    warmFlows(m);
    const base = flowBytes(m);
    const field = m.grid.cols * m.grid.rows * 2;
    const drop = (x: number, y: number) => m.assets.effects.push({ side: 'nato', asset: 'supply', x, y, until: m.tick + 100, told: true });
    drop(-200, 50);
    crateFlow(m, { x: -200, y: 50 });
    expect(flowBytes(m)).toBe(base + field);
    m.assets.effects = []; // its time is up
    drop(-200, -50);
    crateFlow(m, { x: -200, y: -50 });
    expect(flowBytes(m)).toBe(base + field); // the first one went as the second was built
  });
});
