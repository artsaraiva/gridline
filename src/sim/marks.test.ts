// Mark (#136): the Commander's intel marker. It enters the Side's knowledge as a `marked` sighting, never a Contact.
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import type { Command, MapData, SideId, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;
const GRID = { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' };

/** Open ground 1200 m across, HQs far out on the flanks. */
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
  grid: GRID,
};

/** One Soldier a Squad, no vehicles; Soldiers not placed stay at their HQ. Placing them stands in for a map script. */
function scene(o: { place?: Record<number, Vec2 & { fx?: number; fy?: number }>; tune?: Partial<Tune>; map?: Partial<MapData>; squads?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 1, speedJitter: 0, spread: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, ...NO_TRAITS, ...NO_TEMPO, ...o.tune };
  const m = thinkOnId(createMatch({ seed: 1, map: { ...field, ...o.map }, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' }));
  for (const [id, p] of Object.entries(o.place ?? {})) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const place = (m: Match, x: number, y: number, side: SideId = 'nato'): Command => ({ tick: m.tick, side, kind: 'mark', at: { x, y } });
const marks = (m: Match, side: SideId = 'nato') => commanderView(m, side).marks!;
function run(m: Match, seconds: number, commands: Command[] = []): SimEvent[] {
  const events = step(m, commands);
  for (let i = 1; i < seconds * HZ; i++) events.push(...step(m, []));
  return events;
}

describe('Mark: place, renew, clear', () => {
  it('a Mark shows on its own Side\'s Console only, where it was placed', () => {
    const m = scene();
    step(m, [place(m, 100, 50)]);
    expect(marks(m)).toEqual([{ id: 1, x: 100, y: 50, fade: expect.closeTo(1, 1) }]);
    expect(marks(m, 'pact')).toEqual([]);
  });

  it('is rejected outside the Play Area', () => {
    const m = scene();
    const events = step(m, [place(m, 700, 0)]);
    expect(events).toEqual([expect.objectContaining({ kind: 'rejected', reason: 'outside the Play Area' })]);
    expect(marks(m)).toEqual([]);
  });

  it('a fourth Mark replaces the oldest', () => {
    const m = scene();
    for (const x of [0, 100, 200, 300]) step(m, [place(m, x, 0)]);
    expect(marks(m).map((k) => k.x)).toEqual([100, 200, 300]);
  });

  it('fades over markSeconds and is gone after; a renewed one starts again', () => {
    const m = scene();
    step(m, [place(m, 0, 0), place(m, 100, 0)]);
    run(m, DEFAULT_TUNE.markSeconds / 2);
    expect(marks(m)[0]!.fade).toBeCloseTo(0.5, 1);
    step(m, [{ tick: m.tick, side: 'nato', kind: 'mark', id: 2, at: { x: 100, y: 0 } }]);
    run(m, DEFAULT_TUNE.markSeconds / 2);
    expect(marks(m)).toEqual([{ id: 2, x: 100, y: 0, fade: expect.closeTo(0.5, 1) }]);
  });

  it('the Commander clears one by its id; an unknown id is rejected', () => {
    const m = scene();
    step(m, [place(m, 0, 0)]);
    const events = step(m, [{ tick: m.tick, side: 'nato', kind: 'mark', id: 1, at: null }, { tick: m.tick, side: 'nato', kind: 'mark', id: 9, at: null }]);
    expect(marks(m)).toEqual([]);
    expect(events.filter((e) => e.kind === 'rejected').map((e) => e.reason)).toEqual(['unknown mark']);
  });

  it('ids count within a Side: the enemy\'s Marks leave no gap in them', () => {
    const m = scene();
    step(m, [place(m, 300, 0, 'pact'), place(m, 310, 0, 'pact')]);
    step(m, [place(m, 0, 0)]);
    expect(marks(m).map((k) => k.id)).toEqual([1]);
  });

  it('a Match replayed from the same Mark Commands hashes the same', () => {
    const log = (m: Match): Command[][] => [[place(m, 20, 0), place(m, 300, 100, 'pact')], [], [{ tick: 2, side: 'nato', kind: 'mark', id: 1, at: { x: 20, y: 0 } }], [{ tick: 3, side: 'pact', kind: 'mark', id: 1, at: null }]];
    const hashes = [0, 1].map(() => {
      const m = scene({ place: { 0: { x: 0, y: 0 } } });
      for (const commands of log(m)) step(m, commands);
      run(m, 8);
      return stateHash(m);
    });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('moves the state hash', () => {
    const a = scene();
    const b = scene();
    step(a, []);
    step(b, [place(b, 0, 0)]);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});

describe('Mark: the Side\'s knowledge', () => {
  const points = [
    { id: 'A', name: 'A', x: -450, y: -60, owner: 'nato' as const },
    { id: 'B', name: 'B', x: -250, y: 250 },
  ];
  const goal = (m: Match) => commanderView(m, 'nato').squads[0]!.point;

  it('an own Capture Point with a Mark by it counts as threatened: the Squad that was leaving for B defends A', () => {
    const quiet = scene({ map: { points } });
    run(quiet, 3);
    expect(goal(quiet)).toBe('B');
    const m = scene({ map: { points } });
    run(m, 3, [place(m, -420, -80)]);
    expect(goal(m)).toBe('A');
  });

  it('never shows as a Contact or a Last Known Position, and the enemy\'s Squads know nothing of it', () => {
    const m = scene({ map: { points: [{ ...points[0]!, owner: 'pact' as const }, points[1]!] } });
    run(m, 3, [place(m, -420, -80)]);
    const v = commanderView(m, 'nato');
    expect([...v.contacts, ...v.lastKnown!]).toEqual([]);
    expect(commanderView(m, 'pact').squads[0]!.point).toBe('B'); // its own A is quiet: the Mark is not its Side's
  });
});

describe('Mark: suppressive fire', () => {
  // nato 0 looks west; pact 1 is 100 m behind it, sees it and fires. Nobody can be Wounded.
  const pinned = (o: { tune?: Partial<Tune> } = {}) => scene({ place: { 0: { x: 0, y: 0, fx: -1, fy: 0 }, 1: { x: 100, y: 0, fx: -1, fy: 0 } }, tune: { hp: 1e9, ...o.tune } });
  const suppressive = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { kind: 'suppressive' }> => e.kind === 'suppressive' && e.side === 'nato');
  const ammo = (m: Match) => commanderView(m, 'nato').friendlies.find((s) => s.id === 0)!.ammo;

  it('a Squad under fire from an enemy it cannot see fires at the Mark in range, and its ammunition drops', () => {
    const m = pinned();
    const shots = suppressive(run(m, 6, [place(m, -80, 60)]));
    expect(shots.length).toBeGreaterThan(3);
    for (const e of shots) expect(Math.abs(e.x + 80) + Math.abs(e.y - 60)).toBeLessThanOrEqual(2 * DEFAULT_TUNE.suppressiveScatterM);
    expect(ammo(m)).toBeLessThan(1);
  });

  it('holds its fire with no Mark, with the Mark out of range, and when nobody is firing at it', () => {
    const none = pinned();
    expect(suppressive(run(none, 6))).toEqual([]);
    const far = pinned();
    expect(suppressive(run(far, 6, [place(far, -(DEFAULT_TUNE.fireRangeM + 20), 0)]))).toEqual([]);
    const calm = scene({ place: { 0: { x: 0, y: 0, fx: -1, fy: 0 } } });
    expect(suppressive(run(calm, 6, [place(calm, -80, 60)]))).toEqual([]);
  });
});

describe('Mark: a friendly checks it', () => {
  const CLEAR = DEFAULT_TUNE.markClearSeconds;
  const radio = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { kind: 'radio' }> => e.kind === 'radio' && e.type === 'clear');

  it('a Soldier standing by it with nobody in sight clears it after markClearSeconds, and its Squad calls the grid clear', () => {
    const m = scene({ place: { 0: { x: 0, y: 0 } } });
    const early = run(m, CLEAR - 1, [place(m, 20, 0)]);
    expect(marks(m)).toHaveLength(1);
    const late = run(m, 2);
    expect(marks(m)).toEqual([]);
    expect(radio(early)).toEqual([]);
    expect(radio(late)).toEqual([{ kind: 'radio', side: 'nato', squad: 0, type: 'clear', text: 'clear', grid: 'G7', priority: 1 }]);
  });

  it('stays while an enemy is in sight by it, with a wall between it and the Soldier, and with the Soldier too far', () => {
    const held = scene({ place: { 0: { x: 0, y: 0 }, 1: { x: 40, y: 0, fx: 1, fy: 0 } }, tune: { hp: 1e9 } });
    const walled = scene({ place: { 0: { x: 0, y: 0 } }, map: { walls: [{ x0: 10, y0: -5, x1: 11, y1: 5 }] } });
    const far = scene({ place: { 0: { x: 0, y: 0 } } });
    run(held, CLEAR + 3, [place(held, 20, 0)]);
    run(walled, CLEAR + 3, [place(walled, 20, 0)]);
    run(far, CLEAR + 3, [place(far, DEFAULT_TUNE.markClearM + 5, 0)]);
    for (const m of [held, walled, far]) expect(marks(m)).toHaveLength(1);
  });

  it('a Squad that is not Elite has no voice: the Side net calls it', () => {
    const m = scene({ place: { 0: { x: 0, y: 0 } }, tune: { eliteSquads: 0 } });
    expect(radio(run(m, CLEAR + 1, [place(m, 20, 0)]))).toEqual([expect.objectContaining({ squad: null, text: 'clear', grid: 'G7' })]);
  });

  it('the time a Soldier has stood by it moves the state hash', () => {
    const near = scene({ place: { 0: { x: 0, y: 0 } } });
    const blind = scene({ place: { 0: { x: 0, y: 0 } }, tune: { markClearM: 1 } }); // the same Match, but nobody is near enough to check
    for (const m of [near, blind]) run(m, 1, [place(m, 20, 0)]);
    expect(stateHash(near)).not.toBe(stateHash(blind));
  });
});
