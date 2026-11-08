import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/**
 * Open ground 1200 m across, HQs on the flanks. Point B is neutral and near the nato HQ (what a Squad picks on its own),
 * C is neutral and further out (a Squad only goes there when ordered), A is nato's own and quiet.
 */
const POINTS = [
  { id: 'A', name: 'A', x: -250, y: -250, owner: 'nato' as const },
  { id: 'B', name: 'B', x: -380, y: 0 },
  { id: 'C', name: 'C', x: -250, y: 250 },
];

function field(extra: Partial<MapData> = {}): MapData {
  return {
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
    ...extra,
  };
}

interface Placement {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
}

/** Soldier ids run nato first, squad by squad, `squadSize` each. Nobody sees anybody unless the test turns vision on. */
function scene(o: { place?: Record<number, Placement>; tune?: Partial<Tune>; map?: Partial<MapData>; squads?: number; seed?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, speedJitter: 0, visionM: 0, tanksPerSide: 0, jeepsPerSide: 0, pointJeeps: false, ...o.tune }; // #107 #108: infantry rules only, no vehicles
  const m = createMatch({ seed: o.seed ?? 1, map: field(o.map), tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(o.place ?? {})) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const order = (m: Match, point: string | null, squad = 0): Command => ({ tick: m.tick, side: 'nato', kind: 'order', squad, point });

type Logged = SimEvent & { tick: number };

/** Steps `ticks` times. `at` maps a tick (from now) to the Commands sent on it. Returns every event and nato's view after every step. */
function play(m: Match, ticks: number, at: Record<number, (m: Match) => Command[]> = {}) {
  const events: Logged[] = [];
  const views: CommanderView[] = [];
  const t0 = m.tick;
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    for (const e of step(m, at[tick - t0]?.(m) ?? [])) events.push({ ...e, tick });
    views.push(commanderView(m, 'nato'));
  }
  return { events, views };
}

const sendAt = (tick: number, point: string | null, squad = 0): Record<number, (m: Match) => Command[]> => ({ [tick]: (m) => [order(m, point, squad)] });
const radio = (events: Logged[], type?: string) =>
  events.flatMap((e) => (e.kind === 'radio' && e.side === 'nato' && e.squad === 0 && (!type || e.type === type) ? [e] : []));
const alpha = (v: CommanderView) => v.squads[0]!;
const inside = (v: CommanderView, id: string) => {
  const p = v.points.find((p) => p.id === id)!;
  return v.friendlies.filter((f) => f.squad === 0 && Math.hypot(f.x - p.x, f.y - p.y) < p.radius).length;
};
const natural = 'B';

describe('Order Command', () => {
  it('rejects an unknown Squad, an enemy Squad and an unknown point with an Event, and changes nothing', () => {
    const m = scene({ squads: 2 });
    const bad = (c: Partial<Command>) => step(m, [{ ...order(m, 'C'), ...c } as Command]);
    expect(bad({ squad: 9 })).toContainEqual(expect.objectContaining({ kind: 'rejected', reason: 'unknown squad' }));
    expect(bad({ squad: 2 })).toContainEqual(expect.objectContaining({ kind: 'rejected', reason: 'unknown squad' }));
    expect(bad({ point: 'Z' })).toContainEqual(expect.objectContaining({ kind: 'rejected', reason: 'unknown point' }));
    expect(commanderView(m, 'nato').squads.map((q) => q.order ?? null)).toEqual([null, null]);
  });

  it('shows the Order as pending on the next tick, naming the point', () => {
    const m = scene();
    const { views } = play(m, 2, sendAt(0, 'C'));
    expect(alpha(views[0]!).order).toEqual({ point: 'C', state: 'pending' });
  });
});

describe('compliance', () => {
  it('a Squad ordered to a point it would not pick on its own goes there, takes it and holds it', () => {
    const { views } = play(scene(), 180 * HZ, sendAt(0, 'C'));
    expect(alpha(views[HZ - 1]!)).toMatchObject({ point: natural }); // its own choice until the radio lag is over
    expect(alpha(views[3 * HZ]!)).toMatchObject({ task: 'move', point: 'C', order: { point: 'C', state: 'following' } });
    const end = views.at(-1)!;
    expect(end.points.find((p) => p.id === 'C')!.owner).toBe('nato');
    expect(inside(end, 'C')).toBe(4);
    expect(alpha(end)).toMatchObject({ task: 'hold', point: 'C', order: { point: 'C', state: 'holding' } });
  });

  it('an Order is never lost to a better-scoring point, however far: the +1.5 cannot pay for 1100 m of walking', () => {
    const far = { id: 'Z', name: 'Z', x: 500, y: 500, owner: 'nato' as const };
    const { views } = play(scene({ map: { points: [...POINTS, far] } }), 90 * HZ, sendAt(0, 'Z'));
    for (const v of views.slice(3 * HZ)) expect(alpha(v)).toMatchObject({ task: 'move', point: 'Z' });
  });

  it('contact never stops it: a Squad under fire from a nearby enemy keeps moving toward its point', () => {
    const m = scene({
      place: { 4: { x: -330, y: 100, fx: -1 }, 5: { x: -330, y: 110, fx: -1 }, 6: { x: -330, y: 120, fx: -1 } },
      tune: { visionM: 150, hp: 1e9, retreatSuppression: 9, ammoLow: -1 },
    });
    const { events, views } = play(m, 180 * HZ, sendAt(0, 'C'));
    const to = (v: CommanderView) => Math.hypot(v.friendlies[0]!.x - POINTS[2]!.x, v.friendlies[0]!.y - POINTS[2]!.y);
    expect(events.filter((e) => e.kind === 'shot' && e.side === 'pact' && e.tick > 100 * HZ).length).toBeGreaterThan(0); // still under fire late on
    expect(to(views[40 * HZ]!) - to(views.at(-1)!)).toBeGreaterThan(150); // and closing in all the while
    expect(views.some((v) => alpha(v).order?.state === 'delayed')).toBe(false);
  });
});

describe('Delayed and resumed', () => {
  // The Squad is on its way to C; thirty seconds in, all four run dry (or are shaken) and survival takes over.
  const marching = (shake: (m: Match) => void) => {
    const m = scene({ tune: { ammoLow: 30 } });
    return play(m, 100 * HZ, { 0: (m) => [order(m, 'C')], [30 * HZ]: (m) => (shake(m), []) });
  };
  const dry = (m: Match) => m.soldiers.slice(0, 4).forEach((s) => (s.ammo = 0));
  const shaken = (m: Match) => m.soldiers.slice(0, 4).forEach((s) => (s.suppression = 0.95));

  it('Resupply delays the Order (amber, reason resupply), the Squad radios it, and it resumes once the ammo is back', () => {
    const { events, views } = marching(dry);
    const delayed = views.findIndex((v) => alpha(v).order?.state === 'delayed');
    expect(delayed).toBeGreaterThanOrEqual(30 * HZ);
    expect(alpha(views[delayed]!)).toMatchObject({ task: 'resupply', order: { point: 'C', state: 'delayed', reason: 'resupply' } });
    const told = radio(events, 'delayed');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ text: 'negative, resupplying, will move when clear' });
    const resumed = views.findIndex((v, i) => i > delayed && alpha(v).order?.state === 'following');
    expect(resumed).toBeGreaterThan(delayed);
    expect(alpha(views[resumed]!)).toMatchObject({ task: 'move', point: 'C' });
    expect(radio(events, 'resuming')).toEqual([expect.objectContaining({ text: 'moving to Charlie now' })]);
  });

  it('Retreat delays it with reason retreat and "falling back"', () => {
    const { events, views } = marching(shaken);
    const v = views.find((v) => alpha(v).order?.state === 'delayed')!;
    expect(alpha(v)).toMatchObject({ task: 'retreat', order: { point: 'C', state: 'delayed', reason: 'retreat' } });
    expect(radio(events, 'delayed')[0]).toMatchObject({ text: 'negative, falling back, will move when clear' });
  });

  it('never dropped: the Order is still there through every delay, and the Squad gets there in the end', () => {
    const { views } = marching(dry);
    for (const v of views.slice(HZ * 3)) expect(alpha(v).order?.point).toBe('C');
    expect(alpha(views.at(-1)!).order?.state).toMatch(/following|holding/);
  });

  it('an Order given while the Squad is already falling back is answered "negative", then "moving now" when it resumes', () => {
    const m = scene({ place: { 0: { x: -480, y: 0 }, 1: { x: -480, y: 0 }, 2: { x: -480, y: 0 }, 3: { x: -480, y: 0 } } });
    m.soldiers.slice(0, 4).forEach((s) => (s.ammo = 0));
    const { events } = play(m, 60 * HZ, sendAt(0, 'C'));
    expect(radio(events).map((e) => e.type).filter((t) => t !== 'request')).toEqual(['delayed', 'resuming']); // out of ammo, it also asks for Supplies (#41)
  });
});

describe('never dropped', () => {
  it('through a hard fight on both sides the Order stays', () => {
    const m = scene({ squads: 3, tune: { visionM: 150 } });
    const { events, views } = play(m, 300 * HZ, sendAt(0, 'C'));
    for (const v of views.slice(HZ)) expect(alpha(v).order?.point).toBe('C');
    expect(events.some((e) => e.kind === 'shot')).toBe(true); // it did fight
  });
});

describe('hold', () => {
  it('taking the point turns the Order into hold, kept (the Squad stays inside the leash) until the Commander changes it', () => {
    const { views } = play(scene(), 200 * HZ, sendAt(0, 'C'));
    const taken = views.findIndex((v) => v.points.find((p) => p.id === 'C')!.owner === 'nato');
    expect(taken).toBeGreaterThan(0);
    expect(alpha(views[taken - 1]!).order).toEqual({ point: 'C', state: 'following' });
    for (const v of views.slice(taken)) expect(alpha(v).order).toEqual({ point: 'C', state: 'holding' });
    const c = POINTS[2]!;
    for (const f of views.at(-1)!.friendlies.filter((f) => f.squad === 0)) expect(Math.hypot(f.x - c.x, f.y - c.y)).toBeLessThan(25 * 1.5 + 2);
  });

  it('an Order to an own point is hold from the start', () => {
    const { events, views } = play(scene(), 5 * HZ, sendAt(0, 'A'));
    expect(alpha(views.at(-1)!).order).toEqual({ point: 'A', state: 'holding' });
    expect(radio(events, 'ack')).toEqual([expect.objectContaining({ text: 'copy, holding Alpha' })]);
  });
});

describe('radio acks', () => {
  it('"copy, moving to Charlie", 1 to 2 s after the Order, from that Squad, and the Squad acts only after it', () => {
    const lags = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { events, views } = play(scene({ seed }), 6 * HZ, sendAt(0, 'C'));
      const acks = radio(events, 'ack');
      expect(acks).toHaveLength(1);
      expect(acks[0]).toMatchObject({ text: 'copy, moving to Charlie', side: 'nato', squad: 0 });
      const lag = acks[0]!.tick;
      expect(lag).toBeGreaterThanOrEqual(HZ);
      expect(lag).toBeLessThanOrEqual(2 * HZ);
      lags.add(lag);
      for (let i = 0; i <= lag; i++) expect(alpha(views[i]!).point).toBe(natural);
      expect(alpha(views[lag + HZ]!)).toMatchObject({ point: 'C', order: { state: 'following' } });
      expect(alpha(views[lag - 1]!).order).toEqual({ point: 'C', state: 'pending' });
    }
    expect(lags.size).toBeGreaterThan(2); // seeded, not fixed
  });

  it('the same seed and Orders give the same lag and the same hash', () => {
    const run = () => {
      const m = scene({ seed: 5 });
      const { events } = play(m, 4 * HZ, sendAt(3, 'C'));
      return [radio(events, 'ack')[0]!.tick, stateHash(m)];
    };
    expect(run()).toEqual(run());
  });

  it('a quick re-order acks only the latest', () => {
    const { events, views } = play(scene(), 6 * HZ, { 0: (m) => [order(m, 'C')], 8: (m) => [order(m, 'A')] });
    expect(radio(events, 'ack').map((e) => e.text)).toEqual(['copy, holding Alpha']);
    expect(alpha(views.at(-1)!).order).toEqual({ point: 'A', state: 'holding' });
    expect(alpha(views[9]!).order).toEqual({ point: 'A', state: 'pending' });
  });

  it('clearing: "copy, free to engage" after the lag, then the Squad is back on its own choice', () => {
    const { events, views } = play(scene(), 60 * HZ, { 0: (m) => [order(m, 'C')], [4 * HZ]: (m) => [order(m, null)] });
    const cleared = radio(events, 'ack').at(-1)!;
    expect(cleared).toMatchObject({ text: 'copy, free to engage' });
    expect(cleared.tick - 4 * HZ).toBeGreaterThanOrEqual(HZ);
    expect(cleared.tick - 4 * HZ).toBeLessThanOrEqual(2 * HZ);
    expect(alpha(views[4 * HZ + 1]!).order).toEqual({ point: null, state: 'pending' });
    expect(alpha(views.at(-1)!).order ?? null).toBeNull();
    expect(alpha(views[10 * HZ]!).point).toBe(natural);
  });

  it('an Order replaced by a clear within the lag acks only the clear', () => {
    const { events } = play(scene(), 6 * HZ, { 0: (m) => [order(m, 'C')], 5: (m) => [order(m, null)] });
    expect(radio(events, 'ack').map((e) => e.text)).toEqual(['copy, free to engage']);
  });
});

describe('Redeploy', () => {
  // Two Squads of 1 a Side. nato id 0 and pact id 2 shoot each other on tick 0 and bleed out: both Squads are wiped.
  // A (north) and D (south) are nato's and can't change hands.
  const pts = [
    { id: 'A', name: 'A', x: 0, y: 300, owner: 'nato' as const },
    { id: 'D', name: 'D', x: 0, y: -300, owner: 'nato' as const },
  ];
  const wiped = (point: string | null) => {
    const m = scene({
      place: { 0: { x: 0, y: 0, fx: -1 }, 2: { x: -100, y: 0, fx: 1 } },
      tune: { hitChance: 1, damage: [100, 100], squadSize: 1, visionM: 150, captureSeconds: 1e6 },
      map: { points: pts },
      squads: 2,
    });
    const { events, views } = play(m, 40 * HZ, sendAt(0, point));
    return { redeploy: events.find((e) => e.kind === 'redeploy' && e.side === 'nato' && e.squad === 0), views };
  };

  it('a wiped Squad keeps its Order, and the Order steers where it comes back: the owned point nearest the ordered one', () => {
    const north = wiped('A');
    const south = wiped('D');
    expect(north.redeploy).toMatchObject({ x: 0, y: 300 });
    expect(south.redeploy).toMatchObject({ x: 0, y: -300 });
    for (const { views } of [north, south]) {
      expect(alpha(views[15 * HZ]!)).toMatchObject({ strength: 0 }); // wiped
    }
    expect(alpha(north.views[15 * HZ]!).order?.point).toBe('A');
    expect(alpha(north.views.at(-1)!)).toMatchObject({ strength: 1, order: { point: 'A', state: 'holding' } });
    expect(alpha(south.views[15 * HZ]!).order?.point).toBe('D');
    expect(alpha(south.views.at(-1)!)).toMatchObject({ strength: 1, order: { point: 'D', state: 'holding' } });
  });
});
