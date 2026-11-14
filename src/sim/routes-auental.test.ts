import { describe, expect, it } from 'vitest';
import { bake } from '../../scripts/bakes';
import { crossingFlow, flowDist, pointFlow } from './ai/flow';
import { chooseRoute, logDeath } from './ai/routes';
import { createMatch } from './index';
import { NO_TEMPO, NO_TRAITS } from './test-tune';
import { DEFAULT_TUNE } from './tune';
import type { SideId, Vec2 } from './types';

// #156: Squads' crossings through Auental's twin town, on the committed bake. No jitter and nobody seen, so a route is its
// length and the losses the test puts near its crossing.
const AUENTAL = bake('auental');
const m = createMatch({ seed: 1, map: AUENTAL, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, ...NO_TEMPO, routeJitterM: 0, visionM: 0 }, squadsPerSide: 1, commanderSide: 'nato' });
const t = m.tune;
const crossing = (id: string) => AUENTAL.crossings.findIndex((c) => c.id === id);
const point = (id: string) => m.points.findIndex((p) => p.id === id);
const E = m.points[point('E')]!;
const H = m.points[point('H')]!;

/** Metres from `from` to point `to` over each crossing, by id; the way `chooseRoute` measures it. */
function lengths(from: Vec2, to: string): Record<string, number> {
  const pf = pointFlow(m, point(to));
  return Object.fromEntries(AUENTAL.crossings.map((c, i) => [c.id, flowDist(m, crossingFlow(m, i), from) + flowDist(m, pf, c)]));
}

/** The crossing `side`'s Squad takes from `from` to point `to` after losing a Squad's worth of Soldiers at each crossing in `lostAt`. */
function route(side: SideId, from: Vec2, to: string, lostAt: string[] = []): string | null {
  m.deaths = [];
  for (const id of lostAt) {
    const c = AUENTAL.crossings[crossing(id)]!;
    for (let k = 0; k < t.squadSize; k++) logDeath(m, { side, x: c.x + k - 1.5, y: c.y, tick: m.tick });
  }
  const sq = m.squads.find((s) => s.side === side)!;
  chooseRoute(m, sq, from, point(to));
  return sq.route < 0 ? null : AUENTAL.crossings[sq.route]!.id;
}

describe('#156: the twin town\'s three crossings', () => {
  it('between E and H, the way over either town footbridge stays within the detour a Squad takes, MAIN\'s is the shortest, and neither Side has the better flank', () => {
    const flanks = [[E, 'H'], [H, 'E']].map(([from, to]) => {
      const d = lengths(from as Vec2, to as string);
      expect(Math.min(...Object.values(d)), `to ${to}`).toBe(d.MAIN);
      for (const id of ['NTOWN', 'STOWN']) expect(d[id]! - d.MAIN!, `${id} to ${to}`).toBeLessThanOrEqual(t.routeMaxDetourM - 15); // with room to spare
      for (const id of ['RAIL', 'WEIR']) expect(d[id]! - d.MAIN!, `${id} to ${to}`).toBeGreaterThan(t.routeMaxDetourM); // outside the town
      return [d.NTOWN! - d.MAIN!, d.STOWN! - d.MAIN!].sort((a, b) => a - b);
    });
    // the halves of the town are not twins, so neither are the ways through them: each Side's nearer flank and its farther one are as long as the other's
    for (const k of [0, 1]) expect(Math.abs(flanks[0]![k]! - flanks[1]![k]!)).toBeLessThan(15);
  }, 60_000);

  it('a Squad from E to H takes MAIN, a town footbridge when it lost Soldiers on MAIN, and MAIN again when it lost them at that footbridge instead', () => {
    expect(route('nato', E, 'H')).toBe('MAIN');
    const flank = route('nato', E, 'H', ['MAIN'])!;
    expect(['NTOWN', 'STOWN']).toContain(flank);
    expect(route('nato', E, 'H', [flank])).toBe('MAIN');
    expect(route('nato', E, 'H', ['MAIN', flank])).toBe(flank === 'NTOWN' ? 'STOWN' : 'NTOWN'); // the town's third crossing
  }, 60_000);

  it('so does a Squad from H to E, under the half turn', () => {
    expect(route('pact', H, 'E')).toBe('MAIN');
    const flank = route('pact', H, 'E', ['MAIN'])!;
    expect(['NTOWN', 'STOWN']).toContain(flank);
    expect(route('pact', H, 'E', [flank])).toBe('MAIN');
    expect(route('pact', H, 'E', ['MAIN', flank])).toBe(flank === 'NTOWN' ? 'STOWN' : 'NTOWN');
  }, 60_000);
});
