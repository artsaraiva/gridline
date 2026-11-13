import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { AssetKind, Command, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks, no Capture Points: Soldiers not placed stay at their HQ. */
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [],
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
};

type Placement = { x: number; y: number; fx?: number; fy?: number };

/** Like fog.test.ts `scene`: placing Soldiers stands in for a map script; everything after runs through `step`. Nobody fires. */
function scene(place: Record<number, Placement> = {}, o: { tune?: Partial<Tune>; squads?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 1, speedJitter: 0, spread: 0, fireRangeM: 0, ...o.tune };
  const m = createMatch({ seed: 1, map: field, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const scan = (m: Match, at: Vec2): Extract<Command, { kind: 'asset' }> => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'scan', at });

/** Steps `ticks` times with no Commands; every event. */
function run(m: Match, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(m, []));
  return events;
}

const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));

describe('calling an Asset', () => {
  it('Scan UAV is ready at match start; calling it is accepted with a radio line naming the grid', () => {
    const m = scene();
    expect(commanderView(m, 'nato').assets?.find((a) => a.asset === 'scan')?.readyIn).toBe(0);
    const events = step(m, [scan(m, { x: 50, y: 50 })]);
    expect(rejections(events)).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'radio', side: 'nato', squad: null, grid: 'G6' }));
  });

  it('the cooldown starts on the call: Scan is rejected for 60 s, then ready again', () => {
    const m = scene();
    const readyIn = () => commanderView(m, 'nato').assets!.find((a) => a.asset === 'scan')!.readyIn;
    step(m, [scan(m, { x: 0, y: 0 })]);
    expect(readyIn()).toBeCloseTo(60 - 1 / HZ);
    run(m, 30 * HZ - 1);
    expect(readyIn()).toBe(30);
    expect(rejections(step(m, [scan(m, { x: 0, y: 0 })]))).toEqual(['cooling down']);
    run(m, 30 * HZ - 1);
    expect(readyIn()).toBe(0);
    expect(rejections(step(m, [scan(m, { x: 0, y: 0 })]))).toEqual([]);
  });

  it('each Side has its own cooldown', () => {
    const m = scene();
    step(m, [scan(m, { x: 0, y: 0 })]);
    expect(rejections(step(m, [{ ...scan(m, { x: 0, y: 0 }), side: 'pact' }]))).toEqual([]);
  });

  it('is rejected outside the Play Area or on the enemy HQ, and the cooldown does not start', () => {
    const m = scene();
    expect(rejections(step(m, [scan(m, { x: 0, y: 700 })]))).toEqual(['outside the Play Area']);
    expect(rejections(step(m, [scan(m, { x: 550, y: 10 })]))).toEqual(['on the enemy HQ']);
    expect(rejections(step(m, [scan(m, { x: -550, y: 10 })]))).toEqual([]); // the own HQ is fine
  });

  it("is rejected anywhere on an enemy HQ's area, however far from its centre", () => {
    // pact's HQ is the box x 400..600 round its centre at 560
    const area = [{ x: 400, y: -150 }, { x: 600, y: -150 }, { x: 600, y: 150 }, { x: 400, y: 150 }];
    const m = createMatch({ seed: 1, map: { ...field, hqs: { ...field.hqs, pact: { x: 560, y: 0, area } } }, tune: DEFAULT_TUNE, squadsPerSide: 1, commanderSide: 'nato' });
    expect(rejections(step(m, [scan(m, { x: 410, y: 140 })]))).toEqual(['on the enemy HQ']);
    expect(rejections(step(m, [scan(m, { x: 390, y: 140 })]))).toEqual([]);
  });

  it('an Asset that is not in the game is rejected', () => {
    const m = scene();
    expect(rejections(step(m, [{ ...scan(m, { x: 0, y: 0 }), asset: 'nope' as AssetKind }]))).toEqual(['not available']);
  });
});

describe('Scan UAV', () => {
  // Two Squads of 1 a Side: nato 0 and 1 stay at their HQ, far out of sight of pact 2 and 3. Scan is called on tick 0.
  const views = (m: Match, ticks: number, each?: (i: number) => void) => {
    const out = [];
    for (let i = 0; i < ticks; i++) {
      each?.(i);
      step(m, i === 0 ? [scan(m, { x: 200, y: 0 })] : []);
      out.push(commanderView(m, 'nato'));
    }
    return out;
  };

  it('reveals every enemy within 60 m of its spot as a live Contact for 15 s, then as a fading Last Known Position', () => {
    const m = scene({ 2: { x: 200, y: 10 }, 3: { x: 200, y: 70 } }, { squads: 2 });
    // pact 2 moves 30 m east 5 s in (placing it stands in for walking)
    const vs = views(m, 17 * HZ, (i) => i === 5 * HZ && Object.assign(m.soldiers[2]!, { x: 230 }));
    const during = vs.slice(0, 15 * HZ);
    expect(during.every((v) => v.contacts.length === 1 && v.contacts[0]!.id === 2)).toBe(true);
    expect(during[5 * HZ - 1]!.contacts[0]!.x).toBe(200);
    expect(during[5 * HZ]!.contacts[0]!.x).toBe(230);
    const after = vs[15 * HZ]!;
    expect(after.contacts).toEqual([]);
    expect(after.lastKnown).toMatchObject([{ x: 230, y: 10 }]);
  });

  it('writes its reveals into every friendly Squad memory, and no enemy one', () => {
    const m = scene({ 2: { x: 200, y: 10 } }, { squads: 2 });
    views(m, 1);
    const memory = (squad: number) => m.squads[squad]!.memory.map((s) => [s.id, s.source]);
    expect([memory(0), memory(1), memory(2), memory(3)]).toEqual([[[2, 'seen']], [[2, 'seen']], [], []]);
  });

  it('does not reveal enemies inside their own HQ', () => {
    const m = scene({ 2: { x: 540, y: 0 } }, { squads: 2 });
    step(m, [scan(m, { x: 500, y: 0 })]);
    expect(commanderView(m, 'nato').contacts).toEqual([]);
  });

  it('shows on the map with its time left until it goes', () => {
    const vs = views(scene(), 15 * HZ);
    expect(vs[0]!.effects).toEqual([{ asset: 'scan', x: 200, y: 0, radius: 60, left: 15 - 1 / HZ, total: 15 }]);
    expect(vs[15 * HZ - 2]!.effects![0]!.left).toBeCloseTo(1 / HZ);
    expect(vs[15 * HZ - 1]!.effects).toEqual([]);
  });

  it('radios inbound at the call, once when it first reveals enemies, and off station as it leaves, found or not (#85)', () => {
    const lines = (m: Match) => {
      const out: [number, string][] = [];
      for (let i = 0; i < 16 * HZ; i++) for (const e of step(m, i === 0 ? [scan(m, { x: 200, y: 0 })] : [])) if (e.kind === 'radio' && e.type === 'asset') out.push([i, e.text]); // Squad Callouts are radio.test.ts's
      return out;
    };
    // no "UAV on station": the UAV has no fly-in (the Console draws it in orbit from its first tick), so inbound is that moment
    expect(lines(scene({ 2: { x: 200, y: 10 }, 3: { x: 210, y: 0 } }, { squads: 2 }))).toEqual([
      [0, 'Scan UAV inbound'],
      [0, 'UAV eyes on 2 hostiles'],
      [15 * HZ - 1, 'UAV off station'],
    ]);
    expect(lines(scene())).toEqual([
      [0, 'Scan UAV inbound'],
      [15 * HZ - 1, 'UAV off station, no contacts'],
    ]);
  });
});
