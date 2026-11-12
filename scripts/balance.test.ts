import { expect, it } from 'vitest';
import { RIVER_FIELD } from '../src/maps/river-field';
import { balance, report } from './balance';

it('plays whole matches over seeds, summarises them, and takes tune overrides', () => {
  const b = balance({ seeds: 2, squads: 3, map: RIVER_FIELD, tune: { matchSeconds: 150 } });
  expect(b.matches.map((r) => r.seed)).toEqual([1, 2]);
  for (const r of b.matches) expect(r.seconds).toBeLessThanOrEqual(150);
  expect(b.wins.nato + b.wins.pact + b.wins.draw).toBe(2);
  expect(Object.keys(b.picks).length).toBeGreaterThan(0);
  expect(Object.values(b.firstPicks).reduce((a, n) => a + n, 0)).toBe(2 * 2 * 3); // #120: every Squad's first point, three a Side
  expect(b.opening.nato).toBeGreaterThanOrEqual(1);
  expect(b.matches.every((r) => r.heliSquads.nato.length <= 1)).toBe(true); // #122: one helicopter a Side, boarded once
  for (const z of Object.values(b.zoneSpread)) expect(z.apart).toBeGreaterThanOrEqual(0); // #124: Landing Zones are reported per goal
  expect(b.matches.flatMap((r) => r.zones).length).toBeGreaterThan(0);
  const text = report(b);
  for (const z of b.matches.flatMap((r) => r.zones)) expect(text).toContain(`${z.side} ${z.goal} at ${z.x.toFixed(0)}, ${z.y.toFixed(0)}`); // #124: every Landing Zone with its goal
  for (const side of ['nato', 'pact'] as const) for (const r of b.matches) expect(Object.values(r.jobSeconds[side]).reduce((x, y) => x + y, 0)).toBeGreaterThan(0); // #131: each Side's helicopter has a job all along
  expect(text).toContain('mean seconds a match by job'); // #131
  for (const side of ['nato', 'pact'] as const) {
    for (const r of b.matches) expect(r.aboard[side]).toBeGreaterThan(0); // #154: the vehicles waiting at the HQ fill at the opening
    expect(text).toContain(`${side} most Soldiers aboard vehicles at once in the first 2 minutes`);
  }
  expect(balance({ seeds: 2, squads: 3, map: RIVER_FIELD, tune: { matchSeconds: 150 } })).toEqual(b); // deterministic
}, 15_000); // four matches: ~2 s alone, past 5 s beside the rest of the suite
