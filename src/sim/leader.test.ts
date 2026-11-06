import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, MapData, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks, no Capture Points. */
const FIELD: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [],
};

interface Placement {
  x: number;
  y: number;
  fx?: number;
  hp?: number;
}

/**
 * Sets up a scenario. Soldier ids run nato first, squad by squad, `squadSize` each; every Soldier not placed stays at
 * its HQ, far from the fight. Placing Soldiers is the only reach past the Simulation interface: it stands in for a map
 * script, everything after it runs through `step`.
 */
function scene(o: { place?: Record<number, Placement>; tune?: Partial<Tune>; seed?: number }): Match {
  const tune: Tune = { ...DEFAULT_TUNE, speedJitter: 0, spread: 0, ...o.tune };
  const m = createMatch({ seed: o.seed ?? 1, map: FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(o.place ?? {})) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

/** Every shot hits and a single hit Wounds. */
const ONE_SHOT: Partial<Tune> = { hitChance: 1, damage: [100, 100] };

type Logged = SimEvent & { tick: number };

/** Steps `ticks` times; returns every event (with its tick) and the nato Commander view after every step. */
function play(m: Match, ticks: number): { events: Logged[]; views: CommanderView[] } {
  const events: Logged[] = [];
  const views: CommanderView[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    for (const e of step(m, [])) events.push({ ...e, tick });
    views.push(commanderView(m, 'nato'));
  }
  return { events, views };
}

const of = <K extends SimEvent['kind']>(events: Logged[], kind: K, id?: number) =>
  events.filter((e) => e.kind === kind && e.side === 'nato' && (id === undefined || ('id' in e && e.id === id))) as (Logged & { kind: K })[];
const leaderAt = (views: CommanderView[], tick: number) => views[tick]!.squads[0]!.leader;

describe('Squad Leader', () => {
  it('the first roster member leads at the start', () => {
    expect(commanderView(scene({}), 'nato').squads.map((q) => q.leader)).toEqual([0]);
  });

  // nato id 0 (the leader) at the origin facing west and pact id 4 100 m west facing east shoot each other on tick 0.
  // The mates id 1..3 stand 300 m north, out of revive range and out of the enemy's sight.
  const exchange = (extra: { place?: Record<number, Placement>; tune?: Partial<Tune> } = {}) =>
    scene({
      place: { 0: { x: 0, y: 0, fx: -1 }, 1: { x: 0, y: 300 }, 2: { x: 0, y: 302 }, 3: { x: 0, y: 304 }, 4: { x: -100, y: 0, fx: 1 }, ...extra.place },
      tune: { ...ONE_SHOT, reviveRangeM: 0, ...extra.tune },
    });

  it('a Wounded leader keeps leading; once dead, the first alive member in roster order takes over', () => {
    const { events, views } = play(exchange(), 10 * HZ);
    const death = of(events, 'death', 0)[0]!.tick;
    expect(views[0]!.friendlies.find((f) => f.id === 0)!.state).toBe('wounded');
    expect(leaderAt(views, death - 1)).toBe(0);
    expect(leaderAt(views, death)).toBe(1);
  });

  it('a Revive keeps the leader', () => {
    // mate id 1 stands beside the leader and revives them at 3 s
    const { events, views } = play(exchange({ place: { 1: { x: 1, y: 0 } }, tune: { reviveRangeM: DEFAULT_TUNE.reviveRangeM } }), 10 * HZ);
    expect(of(events, 'revived', 0)).toHaveLength(1);
    expect(of(events, 'death')).toEqual([]);
    expect(new Set(views.map((v) => v.squads[0]!.leader))).toEqual(new Set([0]));
  });

  it('a former leader who Squad Respawns does not take leadership back', () => {
    const { events, views } = play(exchange({ tune: { bleedOutSeconds: 1 / HZ } }), 30 * HZ);
    const back = of(events, 'respawn', 0)[0]!.tick;
    expect(leaderAt(views, back - 1)).toBe(1);
    expect(leaderAt(views, back)).toBe(1);
    expect(views[back]!.friendlies.find((f) => f.id === 0)!.state).toBe('alive');
  });

  it('with only Wounded members left the Squad has no leader, until a Redeploy brings the first roster member back', () => {
    // Squads of 2. The leader is Wounded on tick 0; the mate id 1, with double hp facing pact id 3 (unkillable) 200 m
    // north, is Wounded by the second hit a few ticks later, so the leader bleeds out first.
    const m = scene({
      place: { 0: { x: 0, y: 0, fx: -1 }, 1: { x: 0, y: 200, fx: -1, hp: 200 }, 2: { x: -100, y: 0, fx: 1 }, 3: { x: -100, y: 200, fx: 1, hp: 1e9 } },
      tune: { ...ONE_SHOT, squadSize: 2 },
    });
    const { events, views } = play(m, 40 * HZ);
    const [first, last] = of(events, 'death').map((e) => e.tick);
    const redeploy = of(events, 'redeploy')[0]!.tick;
    expect(of(events, 'death').map((e) => e.id)).toEqual([0, 1]);
    expect(first).toBeLessThan(last!);
    expect(leaderAt(views, first!)).toBeNull();
    expect(leaderAt(views, redeploy - 1)).toBeNull();
    expect(leaderAt(views, redeploy)).toBe(0);
  });

  it('leadership is in the state hash: the same seed hashes the same, a different leader differently', () => {
    const twin = () => {
      const m = exchange();
      play(m, 10 * HZ); // the leader died at 8 s and id 1 took over
      return m;
    };
    const [a, b] = [twin(), twin()];
    expect(stateHash(a)).toBe(stateHash(b));
    b.squads[0]!.leader = 2;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});
