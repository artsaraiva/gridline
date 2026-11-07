import { expect, it } from 'vitest';
import { RIVER_FIELD } from '../src/maps/river-field';
import { balance } from './balance';

it('plays whole matches over seeds, summarises them, and takes tune overrides', () => {
  const b = balance({ seeds: 2, squads: 3, map: RIVER_FIELD, tune: { matchSeconds: 90 } });
  expect(b.matches.map((r) => r.seed)).toEqual([1, 2]);
  for (const r of b.matches) expect(r.seconds).toBeLessThanOrEqual(90);
  expect(b.wins.nato + b.wins.pact + b.wins.draw).toBe(2);
  expect(Object.keys(b.picks).length).toBeGreaterThan(0);
  expect(balance({ seeds: 2, squads: 3, map: RIVER_FIELD, tune: { matchSeconds: 90 } })).toEqual(b); // deterministic
}, 15_000); // four matches: ~2 s alone, past 5 s beside the rest of the suite
