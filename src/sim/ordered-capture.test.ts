import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground as orders.test.ts: A is nato's own, B neutral near the nato HQ, C neutral further out. */
const POINTS = [
  { id: 'A', name: 'A', x: -250, y: -250, owner: 'nato' as const },
  { id: 'B', name: 'B', x: -380, y: 0 },
  { id: 'C', name: 'C', x: -250, y: 250 },
];

const field: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: POINTS,
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
};

/** Soldier ids run nato first, squad by squad, 4 each. Nobody sees anybody. `frozen`: nobody walks, Squads are moved by hand. */
function scene(o: { tune?: Partial<Tune>; squads?: number; frozen?: boolean } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, speedJitter: 0, visionM: 0, tanksPerSide: 0, ...(o.frozen && { walkSpeed: 0 }), ...o.tune }; // #107: no tanks
  return createMatch({ seed: 1, map: field, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
}

const order = (m: Match, point: string | null, squad = 0): Command => ({ tick: m.tick, side: 'nato', kind: 'order', squad, point });

/** Steps `ticks` times. `at` maps a tick (from now) to the Commands sent on it (or a script that moves Soldiers). Returns every event and nato's view after every step. */
function play(m: Match, ticks: number, at: Record<number, (m: Match) => Command[]> = {}) {
  const events: SimEvent[] = [];
  const views: CommanderView[] = [];
  const t0 = m.tick;
  for (let i = 0; i < ticks; i++) {
    events.push(...step(m, at[m.tick - t0]?.(m) ?? []));
    views.push(commanderView(m, 'nato'));
  }
  return { events, views };
}

const awards = (events: SimEvent[]) => events.filter((e) => e.kind === 'award');
const ORDERED_C = { kind: 'award', side: 'nato', category: 'orders', points: 200, reason: 'Ordered capture of Charlie' };
const owner = (v: CommanderView, id: string) => v.points.find((p) => p.id === id)!.owner;

/** Moves a whole Squad into a point (all four on its centre), or 300 m east of it, out of the way. */
const enter = (m: Match, squad: number, point = 'C') => {
  const p = POINTS.find((p) => p.id === point)!;
  for (const id of m.squads[squad]!.members) Object.assign(m.soldiers[id]!, { x: p.x, y: p.y });
  return [];
};
const leave = (m: Match, squad: number) => {
  for (const id of m.squads[squad]!.members) Object.assign(m.soldiers[id]!, { x: 50, y: 250 });
  return [];
};
const TAKE = 8 * HZ; // four Soldiers alone inside: rate 2.5 over a 20 s stage

describe('Commander Score: ordered capture', () => {
  it('a Squad ordered to attack a point takes it: the ordered capture value, once, on the tick it is taken', () => {
    const { events, views } = play(scene(), 180 * HZ, { 0: (m) => [order(m, 'C')] });
    expect(awards(events)).toEqual([ORDERED_C]);
    expect(views.at(-1)!.score).toEqual({ total: 200, uav: 0, supply: 0, artillery: 0, orders: 200 });
    expect(owner(views.at(-1)!, 'C')).toBe('nato');
  });

  it('an Order given once the Squad is already taking the point earns nothing', () => {
    const m = scene({ frozen: true });
    enter(m, 0);
    const { events, views } = play(m, TAKE + HZ, { 10: (m) => [order(m, 'C')] });
    expect(owner(views.at(-1)!, 'C')).toBe('nato');
    expect(awards(events)).toEqual([]);
  });

  // Ordered to C at tick 0 (acknowledged within 2 s), the Squad is put inside C at 3 s and the Order is changed at 6 s, mid-capture.
  const changed = (to?: string | null) => {
    const m = scene({ frozen: true });
    const { events, views } = play(m, 3 * HZ + TAKE + HZ, { 0: (m) => [order(m, 'C')], [3 * HZ]: (m) => enter(m, 0), [6 * HZ]: (m) => (to === undefined ? [] : [order(m, to)]) });
    expect(owner(views.at(-1)!, 'C')).toBe('nato');
    return awards(events);
  };

  it('an Order given while the Squad walks in, still unacknowledged as it begins taking the point, scores the capture', () => {
    const m = scene({ frozen: true });
    const { events, views } = play(m, TAKE + 2 * HZ, { 0: (m) => [order(m, 'C')], 1: (m) => enter(m, 0) });
    expect(owner(views.at(-1)!, 'C')).toBe('nato');
    expect(awards(events)).toEqual([ORDERED_C]);
  });

  it('a clear sent and not yet acknowledged when the point is taken earns nothing', () => {
    const m = scene({ frozen: true });
    const { events, views } = play(m, 3 * HZ + TAKE + HZ, { 0: (m) => [order(m, 'C')], [3 * HZ]: (m) => enter(m, 0), [3 * HZ + TAKE - 5]: (m) => [order(m, null)] });
    expect(owner(views.at(-1)!, 'C')).toBe('nato');
    expect(views[3 * HZ + TAKE - 1]!.squads[0]!.order).toEqual({ point: null, state: 'pending' }); // still pending at the capture
    expect(awards(events)).toEqual([]);
  });

  it('left alone, that Order scores the capture', () => expect(changed()).toEqual([ORDERED_C]));
  it('clearing the Order before the point is taken earns nothing', () => expect(changed(null)).toEqual([]));
  it('replacing it with an Order elsewhere earns nothing', () => expect(changed('A')).toEqual([]));
  it('reissuing the same Order cannot credit the capture already underway', () => expect(changed('C')).toEqual([]));

  it('several ordered Squads on one capture score once', () => {
    const m = scene({ frozen: true, squads: 2 });
    const { events, views } = play(m, 3 * HZ + TAKE, { 0: (m) => [order(m, 'C', 0), order(m, 'C', 1)], [3 * HZ]: (m) => (enter(m, 0), enter(m, 1)) });
    expect(owner(views.at(-1)!, 'C')).toBe('nato');
    expect(awards(events)).toEqual([ORDERED_C]);
    expect(views.at(-1)!.score!.orders).toBe(200);
  });

  it('a genuine recapture under the same Order scores again: nato takes C, pact takes it back, nato retakes it', () => {
    const m = scene({ frozen: true }); // pact's Squad is 1
    const { events, views } = play(m, 3 * HZ + TAKE + 2 * (2 * TAKE), {
      0: (m) => [order(m, 'C')],
      [3 * HZ]: (m) => enter(m, 0),
      [3 * HZ + TAKE]: (m) => (leave(m, 0), enter(m, 1)), // C is nato's: pact walks it back through neutral to its own
      [3 * HZ + 3 * TAKE]: (m) => (leave(m, 1), enter(m, 0)),
    });
    expect(views[3 * HZ + 3 * TAKE - 1]!.points.find((p) => p.id === 'C')!.owner).toBe('pact');
    expect(owner(views.at(-1)!, 'C')).toBe('nato');
    expect(awards(events)).toEqual([ORDERED_C, ORDERED_C]);
    expect(views.at(-1)!.score!.orders).toBe(400);
  });

  it('interrupted and contested participation under the same Order still scores', () => {
    const m = scene({ frozen: true });
    const { events, views } = play(m, 3 * HZ + 2 * TAKE, {
      0: (m) => [order(m, 'C')],
      [3 * HZ]: (m) => enter(m, 0),
      [5 * HZ]: (m) => (leave(m, 0), enter(m, 1)), // pact pushes the progress back for a while
      [6 * HZ]: (m) => (leave(m, 1), enter(m, 0)),
    });
    expect(owner(views.at(-1)!, 'C')).toBe('nato');
    expect(awards(events)).toEqual([ORDERED_C]);
  });

  it('eligibility is in the state hash: when the Order was given, and what the Squad is taking since when', () => {
    const m = scene({ frozen: true });
    play(m, 4 * HZ, { 0: (m) => [order(m, 'C')], [3 * HZ]: (m) => enter(m, 0) });
    const h = stateHash(m);
    const sq = m.squads[0]!;
    sq.order!.since++;
    expect(stateHash(m)).not.toBe(h);
    sq.order!.since--;
    sq.takingSince++;
    expect(stateHash(m)).not.toBe(h);
    sq.takingSince--;
    sq.taking = -1;
    expect(stateHash(m)).not.toBe(h);
  });
});
