import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks, no Capture Points: Soldiers not placed stand at their HQ. */
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

/** Six Soldiers a Side (nato 0..5, pact 6..11) who do not fire or walk; no vehicles; the Creeping Barrage ready at once. */
function scene(place: Record<number, Vec2> = {}, tune: Partial<Tune> = {}, seed = 1): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, walkSpeed: 0, creepCooldownSeconds: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, ...tune };
  const m = createMatch({ seed, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

// The line runs east from (0, 100): shells land every 10 m from x = 0 to x = 110, up to 4 m north or south of y = 100.
const START: Vec2 = { x: 0, y: 100 };
const EAST: Vec2 = { x: 50, y: 100 };
const creep = (m: Match, at = START, to = EAST): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'creep', at, to });

type Stamped = SimEvent & { tick: number };
interface Run {
  events: Stamped[];
  nato: CommanderView[]; // the view after each step: nato[i] follows the step of tick i
  pact: CommanderView[];
}

/** Calls the Creeping Barrage on the first tick and steps to the end of second `seconds`. */
function play(m: Match, seconds = 30): Run {
  const run: Run = { events: [], nato: [], pact: [] };
  for (let i = 0; i < seconds * HZ; i++) {
    const tick = m.tick;
    run.events.push(...step(m, i === 0 ? [creep(m)] : []).map((e) => ({ ...e, tick })));
    run.nato.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

const impacts = (r: Run) => r.events.filter((e): e is Extract<Stamped, { kind: 'impact' }> => e.kind === 'impact');
const fx = (v: CommanderView) => v.effects!.find((e) => e.asset === 'creep');
const ids = (v: CommanderView) => v.contacts.map((c) => c.id);

describe('Creeping Barrage: the call', () => {
  it('starts on cooldown: first ready at 2:30, a line 120 m long', () => {
    const m = createMatch({ seed: 1, map: field, tune: DEFAULT_TUNE, squadsPerSide: 1, commanderSide: 'nato' });
    expect(commanderView(m, 'nato').assets!.find((a) => a.asset === 'creep')).toEqual({ asset: 'creep', readyIn: 150, cooldown: 150, radius: 18, line: { length: 120, width: 36 } });
    expect(step(m, [creep(m)]).map((e) => e.kind === 'rejected' && e.reason)).toEqual(['cooling down']);
  });

  it('a Squad never Requests it', () => {
    // most of the Squad pinned by enemies it sees asks for fire support: the Barrage, as before
    const m = scene({ 0: { x: 0, y: 0 }, 6: { x: 80, y: 0 } }, { eliteSquads: 1 });
    for (const s of m.soldiers) if (s.side === 'nato') Object.assign(s, { x: 0, y: 0, suppression: 1 });
    step(m, []);
    expect(commanderView(m, 'nato').squads[0]!.request).toMatchObject({ asset: 'barrage' });
  });
});

describe('Creeping Barrage: the march', () => {
  it('the first shell lands 10 s after the call at the start, then one every 1.5 s, each 10 m further along; the twelfth 16.5 s later', () => {
    const run = play(scene());
    const hits = impacts(run);
    expect(hits.map((h) => h.tick / HZ)).toEqual([10, 11.5, 13, 14.5, 16, 17.5, 19, 20.5, 22, 23.5, 25, 26.5]);
    expect(hits.map((h) => Math.round((h.x / 10) * 1e6) / 1e6)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const h of hits) expect(Math.abs(h.y - 100)).toBeLessThan(4);
    expect(new Set(hits.map((h) => h.y)).size).toBe(12); // each scattered on its own
    expect(hits[0]).toMatchObject({ side: 'nato', asset: 'creep' });
    expect(run.events.filter((e) => e.kind === 'radio').map((e) => [e.tick / HZ, e.text])).toEqual([
      [0, 'Creeping fire inbound'],
      [10, 'Splash'],
    ]);
  });

  it('each shell is 4 s in the air: one or two fly at a time, and the count runs down to the first', () => {
    const { nato } = play(scene());
    const at = (s: number) => fx(nato[s * HZ - 1]!)!;
    expect(at(5)).toMatchObject({ x: 0, y: 100, impactIn: 5, shells: [], line: { to: { x: 120, y: 100 }, width: 36 } });
    expect(at(8).shells).toEqual([{ x: 0, y: expect.any(Number), flight: 0.5 }, { x: 10, y: expect.any(Number), flight: 0.125 }]);
    expect(at(12).impactIn).toBe(0);
    expect(fx(nato[29 * HZ]!)).toBeUndefined(); // 26.5 s and the Contacts' 2 s
  });

  it("the shells in flight are in the enemy's view too; the strip and the count are not", () => {
    const { pact } = play(scene());
    const theirs = fx(pact[8 * HZ - 1]!)!;
    expect(Object.keys(theirs).sort()).toEqual(['asset', 'left', 'radius', 'shells', 'side', 'total', 'x', 'y']);
    expect(theirs).toMatchObject({ side: 'nato', shells: [{ flight: 0.5 }, { flight: 0.125 }] });
  });
});

describe('Creeping Barrage: the effect', () => {
  // where the shells land on seed 1, found by a dry run: the spots are drawn at the call
  const spots = impacts(play(scene())).map(({ x, y }) => ({ x, y }));

  it('a Soldier on a shell\'s spot dies; one 10 m from the line is suppressed to full and not Wounded; one 30 m off is untouched', () => {
    const m = scene({ 6: spots[3]!, 7: { x: 55, y: 110 }, 8: { x: 55, y: 130 }, 0: { x: 85, y: 90 } });
    const run = play(m);
    expect(run.events.flatMap((e) => (e.kind === 'death' || e.kind === 'wounded' ? [[e.kind, e.id, e.tick / HZ]] : []))).toEqual([['death', 6, 14.5]]);
    expect(m.soldiers[7]).toMatchObject({ state: 'alive', hp: DEFAULT_TUNE.hp });
    expect(m.soldiers[8]).toMatchObject({ state: 'alive', hp: DEFAULT_TUNE.hp, suppression: 0 });
    expect(m.soldiers[0]).toMatchObject({ state: 'alive', hp: DEFAULT_TUNE.hp }); // its own Side's, 10 m off: no hold-out, and no harm at that range
    const peak = (id: number) => {
      const again = scene({ 6: spots[3]!, 7: { x: 55, y: 110 }, 8: { x: 55, y: 130 }, 0: { x: 85, y: 90 } });
      let most = 0;
      for (let i = 0; i < 30 * HZ; i++) {
        step(again, i === 0 ? [creep(again)] : []);
        most = Math.max(most, again.soldiers[id]!.suppression);
      }
      return most;
    };
    expect(peak(7)).toBeGreaterThan(0.9); // set to 1 as a shell lands, read after that tick's decay
    expect(peak(0)).toBeGreaterThan(0.9);
  });

  it('a kill scores the caller in artillery at the shell tariff; a friendly killed scores nobody', () => {
    const m = scene({ 6: spots[3]!, 0: spots[8]! });
    const run = play(m);
    expect(run.events.flatMap((e) => (e.kind === 'death' ? [e.id] : []))).toEqual([6, 0]);
    expect(run.events.filter((e) => e.kind === 'award')).toEqual([{ kind: 'award', side: 'nato', category: 'artillery', points: DEFAULT_TUNE.scoreArtilleryKill, reason: 'Creeping Barrage kill', tick: 14.5 * HZ }]);
  });

  it('Contacts light up along the line in sequence: each enemy within 14 m of a landed shell, for 2 s', () => {
    const m = scene({ 6: { x: 0, y: 112 }, 7: { x: 60, y: 112 }, 8: { x: 110, y: 112 }, 9: { x: 60, y: 140 } });
    const { nato } = play(m);
    const at = (s: number) => ids(nato[s * HZ - 1]!);
    expect(at(9.5)).toEqual([]);
    expect(at(10.5)).toEqual([6]);
    expect(at(14)).toEqual([]); // the shells at 0 and 10 m are 2 s gone, the one at 50 m not down yet
    expect(at(19.5)).toEqual([7]);
    expect(at(27)).toEqual([8]);
    expect(at(29.5)).toEqual([]);
  });
});

describe('Creeping Barrage: determinism', () => {
  it('the same seed lands the same shells; the line and its shells are in the hash', () => {
    const run = (seed: number, to = EAST) => {
      const m = scene({}, {}, seed);
      step(m, [creep(m, START, to)]);
      return stateHash(m);
    };
    expect(run(1)).toBe(run(1));
    expect(run(1)).not.toBe(run(1, { x: 0, y: 150 }));
    expect(impacts(play(scene({}, {}, 2))).map((h) => h.y)).not.toEqual(impacts(play(scene())).map((h) => h.y));
  });
});
