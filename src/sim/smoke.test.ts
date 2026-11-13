import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks, no Capture Points. */
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

/** One Soldier a Side (nato 0, pact 1), who cannot be Wounded and, unless `tune` says otherwise, does not fire; no vehicles. */
function scene(place: Record<number, Placement>, tune: Partial<Tune> = {}): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 1, speedJitter: 0, spread: 0, hp: 1e9, fireRangeM: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, ...tune };
  const m = createMatch({ seed: 1, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

// The wall runs north from (30, -22.5): its four discs sit at y = -15, 0, 15 and 30, the second on the line between the two Soldiers.
const START: Vec2 = { x: 30, y: -22.5 };
const NORTH: Vec2 = { x: 30, y: 100 };
const smoke = (m: Match, at = START, to: Vec2 | null = NORTH): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'smoke', at, ...(to && { to }) });

interface Run {
  events: SimEvent[];
  nato: CommanderView[]; // the view after each step: nato[i] follows the step of tick i
  pact: CommanderView[];
}

/** Steps to the end of second `seconds`, with `commands` on the first tick. */
function play(m: Match, seconds: number, commands: Command[] = []): Run {
  const run: Run = { events: [], nato: [], pact: [] };
  for (let i = 0; i < seconds * HZ; i++) {
    run.events.push(...step(m, i === 0 ? commands : []));
    run.nato.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

const FACING = { 0: { x: 0, y: 0, fx: 1, fy: 0 }, 1: { x: 60, y: 0, fx: -1, fy: 0 } };
const LANDED = 6.5; // the second shell: the warning, and half a second after the first
/** The view at the end of second `s`. */
const at = (views: CommanderView[], s: number) => views[Math.round(s * HZ) - 1]!;
const ids = (v: CommanderView) => v.contacts.map((c) => c.id);
const row = (m: Match) => commanderView(m, 'nato').assets!.find((a) => a.asset === 'smoke')!;
const fx = (v: CommanderView) => v.effects!.find((e) => e.asset === 'smoke');

describe('Smoke Screen: the call', () => {
  it('is ready at match start, takes a start and a direction, and cools down for 1:30', () => {
    const m = scene({});
    expect(row(m)).toEqual({ asset: 'smoke', readyIn: 0, cooldown: 90, radius: 7.5, line: { length: 60, width: 15 } });
    const { events } = play(m, 1, [smoke(m)]);
    expect(events).toEqual([{ kind: 'radio', side: 'nato', squad: null, type: 'asset', text: 'Smoke inbound', grid: 'G7', priority: 1 }]);
    expect(row(m).readyIn).toBe(89);
    expect(step(m, [smoke(m)]).map((e) => e.kind === 'rejected' && e.reason)).toEqual(['cooling down']);
  });

  it('is rejected with no direction, or a wall that leaves the Play Area or crosses the enemy HQ', () => {
    const m = scene({});
    const why = (c: Command) => step(m, [c]).map((e) => e.kind === 'rejected' && e.reason);
    expect(why(smoke(m, START, null))).toEqual(['needs a direction']);
    expect(why(smoke(m, START, START))).toEqual(['needs a direction']);
    expect(why(smoke(m, { x: 0, y: 570 }, { x: 0, y: 700 }))).toEqual(['outside the Play Area']);
    expect(why(smoke(m, { x: 530, y: -30 }, { x: 530, y: 0 }))).toEqual(['on the enemy HQ']); // both ends clear of the 35 m HQ circle, the middle in it
    expect(commanderView(m, 'nato').effects).toEqual([]);
  });

  it('is rejected across an enemy HQ that is an area, wherever the area reaches', () => {
    // pact's HQ is a strip 20 m wide running 200 m north of its centre: far outside the 35 m circle
    const area = [{ x: 550, y: -10 }, { x: 570, y: -10 }, { x: 570, y: 200 }, { x: 550, y: 200 }];
    const t: Tune = { ...DEFAULT_TUNE, squadSize: 1, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false };
    const m = createMatch({ seed: 1, map: { ...field, hqs: { ...field.hqs, pact: { x: 560, y: 0, area } } }, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
    const why = (c: Command) => step(m, [c]).map((e) => e.kind === 'rejected' && e.reason);
    expect(why(smoke(m, { x: 530, y: 150 }, { x: 600, y: 150 }))).toEqual(['on the enemy HQ']); // through the strip, both ends clear
    expect(why(smoke(m, { x: 530, y: -30 }, { x: 530, y: 0 }))).toEqual([false]); // past the old circle's edge, clear of the area: called
  });

  it('shows the strip from the start, 60 m towards the second tap and 15 m wide, to both Consoles', () => {
    const m = scene({});
    const { nato, pact } = play(m, 1, [smoke(m, START, { x: 30, y: 1000 })]);
    expect(fx(nato[0]!)).toMatchObject({ asset: 'smoke', side: 'nato', x: 30, y: -22.5, line: { to: { x: 30, y: 37.5 }, width: 15 }, impactIn: 5.95, smoke: [] });
    expect(pact[0]!.effects).toEqual(nato[0]!.effects);
  });
});

describe('Smoke Screen: the screen', () => {
  it('two Soldiers 60 m apart stop seeing each other within 5 s of the landing, and see each other again once it has thinned out', () => {
    const m = scene(FACING);
    const { nato, pact } = play(m, LANDED + 5 + 40 + 10 + 1, [smoke(m)]);
    const seen = (s: number) => [ids(at(nato, s)), ids(at(pact, s))];
    expect(seen(LANDED - 1)).toEqual([[1], [0]]);
    for (let s = LANDED + 5; s < LANDED + 5 + 40; s += 5) expect(seen(s)).toEqual([[], []]);
    expect(seen(LANDED + 5 + 40 + 10 + 0.5)).toEqual([[1], [0]]);
  });

  it('four discs land along the wall half a second apart, bloom to 15 m across over 5 s, hold 40 s and thin over 10 s', () => {
    const m = scene({});
    const { nato, events } = play(m, 70, [smoke(m)]);
    const discs = (s: number) => fx(at(nato, s))?.smoke;
    expect(discs(5.5)).toEqual([]);
    expect(discs(8.5)!.map((d) => [d.x, d.y, d.r, d.age, d.density])).toEqual([
      [30, -15, 3.75, 2.5, 1],
      [30, 0, 3, 2, 1],
      [30, 15, 2.25, 1.5, 1],
      [30, 30, 1.5, 1, 1],
    ]);
    expect(discs(30)!.map((d) => d.r)).toEqual([7.5, 7.5, 7.5, 7.5]);
    expect(discs(56)![0]).toMatchObject({ r: 3.75, density: 0.5 }); // the first: 6 s + 5 s + 40 s, and half its thinning
    expect(fx(at(nato, 63))).toBeUndefined(); // 6 + 1.5 + 55 s: the last disc is gone, and the effect with it
    expect(events.filter((e) => e.kind === 'radio').map((e) => e.text)).toEqual(['Smoke inbound', 'Smoke on the deck']);
  });

  it('a Soldier inside the smoke is not seen from outside it and sees nobody', () => {
    const m = scene({ 0: { x: 0, y: 0, fx: 1, fy: 0 }, 1: { x: 30, y: 0, fx: -1, fy: 0 } });
    const { nato, pact } = play(m, LANDED + 6, [smoke(m)]);
    expect([ids(nato.at(-1)!), ids(pact.at(-1)!)]).toEqual([[], []]);
  });

  it('a Scan UAV over the smoke still reveals the Soldiers in and behind it', () => {
    const m = scene({ 0: { x: 0, y: 0, fx: 1, fy: 0 }, 1: { x: 30, y: 0, fx: -1, fy: 0 } });
    play(m, LANDED + 6, [smoke(m)]);
    const { nato } = play(m, 1, [{ tick: m.tick, side: 'nato', kind: 'asset', asset: 'scan', at: { x: 30, y: 0 } }]);
    expect(ids(nato.at(-1)!)).toEqual([1]);
  });

  it('does no harm: a Soldier under a landing is not Wounded, not suppressed, not a Contact, and no Commander Score is paid', () => {
    const m = scene({ 1: { x: 30, y: 0 } }, { hp: DEFAULT_TUNE.hp });
    const { nato, events } = play(m, 20, [smoke(m)]);
    expect(m.soldiers[1]).toMatchObject({ state: 'alive', hp: DEFAULT_TUNE.hp, suppression: 0 });
    expect(nato.flatMap(ids)).toEqual([]);
    expect(events.filter((e) => e.kind !== 'radio')).toEqual([]);
    expect(nato.at(-1)!.score!.total).toBe(0);
  });
});

describe('Smoke Screen: fire through it', () => {
  // pact 1 fires on nato 0 from 60 m; nato 0 faces away and never fires back
  const fight = (smoked: boolean) => {
    const m = scene({ 0: { x: 0, y: 0, fx: -1, fy: 0 }, 1: { x: 60, y: 0, fx: -1, fy: 0 } }, { fireRangeM: DEFAULT_TUNE.fireRangeM, walkSpeed: 0 });
    m.soldiers[0]!.ammo = 0;
    play(m, LANDED, smoked ? [smoke(m)] : []);
    const pinned = m.soldiers[0]!.suppression;
    const blind = play(m, 5 + DEFAULT_TUNE.suppressiveSeconds + 5); // the bloom, then the suppressive fire runs out
    const late = play(m, 10);
    return { m, pinned, blind, late };
  };

  it('a pinned Soldier behind smoke loses its suppression as its attacker loses sight', () => {
    const clear = fight(false);
    const screened = fight(true);
    expect(screened.pinned).toBeGreaterThan(DEFAULT_TUNE.suppressedAt);
    expect(clear.m.soldiers[0]!.suppression).toBeGreaterThan(DEFAULT_TUNE.suppressedAt);
    expect(screened.m.soldiers[0]!.suppression).toBe(0);
  });

  it('suppressive fire still crosses it: the attacker rakes where it last saw its target', () => {
    const { blind, late } = fight(true);
    expect(blind.events.some((e) => e.kind === 'suppressive' && e.side === 'pact')).toBe(true);
    expect(late.events.filter((e) => e.kind === 'shot' || e.kind === 'suppressive')).toEqual([]);
    expect(fight(false).late.events.some((e) => e.kind === 'shot')).toBe(true);
  });
});

describe('Smoke Screen: determinism', () => {
  it('the same call hashes the same; the wall and its discs are in the hash', () => {
    const run = (to: Vec2 | null, seconds: number) => {
      const m = scene(FACING);
      play(m, seconds, to ? [smoke(m, START, to)] : []);
      return stateHash(m);
    };
    expect(run(NORTH, 3)).toBe(run(NORTH, 3));
    expect(run(NORTH, 3)).not.toBe(run(null, 3));
    expect(run(NORTH, 3)).not.toBe(run({ x: 130, y: -22.5 }, 3)); // another direction, before any shell lands
  });
});
