import { describe, expect, it } from 'vitest';
import { RIVER_FIELD } from '../maps/river-field';
import { commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, MapData, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

interface Placement {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
  ammo?: number; // rounds
}

/**
 * Sets up a scenario on `map`. Soldier ids run nato first, squad by squad, `squadSize` each; Soldiers not placed start at
 * their HQ. Placing Soldiers (and their ammo) is the only reach past the Simulation interface: it stands in for a map script.
 */
function scene(o: { map: MapData; place?: Record<number, Placement>; tune?: Partial<Tune>; squads?: number; seed?: number }): Match {
  const tune: Tune = { ...DEFAULT_TUNE, speedJitter: 0, ...o.tune };
  const m = createMatch({ seed: o.seed ?? 1, map: o.map, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(o.place ?? {})) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

/** Steps `ticks` times; returns every event and both Sides' views after every step. */
function play(m: Match, ticks: number) {
  const events: (SimEvent & { tick: number })[] = [];
  const nato: CommanderView[] = [];
  const pact: CommanderView[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    for (const e of step(m, [])) events.push({ ...e, tick });
    nato.push(commanderView(m, 'nato'));
    pact.push(commanderView(m, 'pact'));
  }
  return { events, nato, pact };
}

const routes = (v: CommanderView) => v.squads.map((q) => q.route);

describe('routes over the river', () => {
  const toE: MapData = { ...RIVER_FIELD, points: RIVER_FIELD.points.filter((p) => p.id === 'E') };
  const calm: Partial<Tune> = { visionM: 0, routeJitterM: 0 };

  it('a Squad crosses the river only at a crossing, by the shortest route', () => {
    const { nato } = play(scene({ map: toE, tune: calm }), 150 * HZ);
    expect(nato[HZ]!.squads[0]).toMatchObject({ task: 'move', point: 'E', route: 'N' });
    for (const v of nato) for (const f of v.friendlies) if (Math.abs(f.x) < 6) expect(Math.abs(f.y - 120)).toBeLessThanOrEqual(3);
    const there = nato.findIndex((v) => v.friendlies.every((f) => Math.hypot(f.x - 100, f.y - 140) < 25));
    expect(there).toBeGreaterThan(0);
  });

  it('Squads going to the same point spread over the crossings, never taking one more than 150 m longer', () => {
    // the bridge is 26 m longer than the footbridge, the ford 200 m: a mate on a route adds 80 m to it, so the seventh
    // Squad would find the ford shortest (617 m against 655 and 681) were it not too far round
    const { nato } = play(scene({ map: toE, tune: calm, squads: 7 }), HZ + 1);
    expect(routes(nato[HZ]!).sort()).toEqual(['C', 'C', 'C', 'N', 'N', 'N', 'N']);
  });

  it('seeded jitter varies the pick between near-equal routes', () => {
    const picks = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => routes(play(scene({ map: toE, tune: { visionM: 0 }, seed }), HZ + 1).nato[HZ]!)[0]));
    expect(picks).toEqual(new Set(['N', 'C']));
  });

  // Two Squads of 2 a Side. nato Squad 0 (ids 0, 1) runs into the enemy at the footbridge; Squad 1 (ids 2, 3) decides its
  // route from the HQ a second later. `kind` sets what kind of crossing N is (C becomes a footbridge when N is the bridge).
  const atTheFootbridge = (place: Record<number, Placement>, tune: Partial<Tune>, kind: 'footbridge' | 'bridge' = 'footbridge') => {
    const map = { ...toE, crossings: toE.crossings!.map((c) => (c.id === 'N' ? { ...c, kind } : c.id === 'C' ? { ...c, kind: 'footbridge' as const } : c)) };
    const m = scene({ map, place, tune: { routeJitterM: 0, spread: 0, squadSize: 2, ...tune }, squads: 2 });
    return play(m, HZ + 1).nato[HZ]!.squads[1]!.route;
  };
  // Squad 0 is already over (on E's bank, so it takes no crossing and adds no mate penalty to one).
  // ids 0 and 1 see pact ids 4 and 5 by the footbridge, 40 m off
  const seen = { 0: { x: 60, y: 118, fx: -1 }, 1: { x: 60, y: 122, fx: -1 }, 4: { x: 20, y: 118 }, 5: { x: 20, y: 122 } };
  // ids 0 and 1 face west at the footbridge; ids 4 and 5 shoot them dead from behind, unseen
  const lost = { 0: { x: 10, y: 118, fx: -1 }, 1: { x: 10, y: 122, fx: -1 }, 4: { x: 90, y: 118, fx: -1 }, 5: { x: 90, y: 122, fx: -1 } };
  const killed: Partial<Tune> = { hitChance: 1, damage: [100, 100], reviveRangeM: 0, bleedOutSeconds: 1 / HZ };

  it('enemies seen at a crossing send the next Squad over another one', () => {
    expect(atTheFootbridge(seen, { hp: 1e9 })).toBe('C');
  });

  it('own losses at a crossing send the next Squad over another one', () => {
    expect(atTheFootbridge(lost, killed)).toBe('C');
  });

  it('the centre bridge takes no danger penalties', () => {
    expect(atTheFootbridge(seen, { hp: 1e9 }, 'bridge')).toBe('N');
    expect(atTheFootbridge(lost, killed, 'bridge')).toBe('N');
  });
});
