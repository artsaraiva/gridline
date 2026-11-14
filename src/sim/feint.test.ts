// Feint (#143, was #144), through the Simulation interface: a dummy paratrooper falls under its canopy as the Supply crate
// does, then its firecrackers fake gunfire every few seconds; the enemy Squads that hear it act as under fire until one of
// their Soldiers sees it for what it is.
import { describe, expect, it } from 'vitest';
import { commanderEvents, commanderView, createMatch, stateHash, step, type Match } from './index';
import { RIVER_FIELD } from '../maps/river-field';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SideId, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;
const FALL = DEFAULT_TUNE.supplyFallSeconds;

/** Open ground 1200 m across, HQs far out on the flanks; nato holds A in the west, pact E in the east. */
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [
    { id: 'A', name: 'A', x: -300, y: 0, owner: 'nato' },
    { id: 'E', name: 'E', x: 300, y: 0, owner: 'pact' },
  ],
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
};

/**
 * Four Soldiers a Squad, ids nato first; Soldiers not placed stay at their HQ. Nobody walks, and nobody sees farther than
 * 50 m: a Squad 60 m from the dummy hears its firecrackers (`hearM` 90) and cannot see it. The Feint is ready at once.
 */
function scene(place: Record<number, Vec2 & { fx?: number; fy?: number }> = {}, o: { tune?: Partial<Tune>; squads?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 4, speedJitter: 0, spread: 0, walkSpeed: 0, visionM: 50, strayChance: 0, feintCooldownSeconds: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, ...NO_TRAITS, ...NO_TEMPO, ...o.tune };
  const m = thinkOnId(createMatch({ seed: 1, map: field, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' }));
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const feint = (m: Match, at: Vec2, side: SideId = 'nato'): Command => ({ tick: m.tick, side, kind: 'asset', asset: 'feint', at });

type Stamped = SimEvent & { tick: number };
interface Run {
  events: Stamped[];
  views: CommanderView[]; // nato's view after each step
  pact: CommanderView[];
}

/** Steps `seconds` in all, with `commands` on the first step and `each` before every step. */
function play(m: Match, seconds: number, commands: Command[] = [], each: () => void = () => {}): Run {
  const run: Run = { events: [], views: [], pact: [] };
  for (let i = 0; i < seconds * HZ; i++) {
    each();
    const tick = m.tick;
    run.events.push(...step(m, i === 0 ? commands : []).map((e) => ({ ...e, tick })));
    run.views.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

const radio = (r: Run) => r.events.flatMap((e) => (e.kind === 'radio' && e.type === 'asset' ? [{ tick: e.tick, text: e.text }] : []));
const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));
const row = (v: CommanderView) => v.assets!.find((a) => a.asset === 'feint')!;
const effect = (v: CommanderView) => v.effects!.find((e) => e.asset === 'feint');
const SPOT = { x: 0, y: 0 };

describe('Feint: the call and the fall', () => {
  it('starts on its 120 s cooldown with a 10 m ring and no point gate', () => {
    const m = scene({}, { tune: { feintCooldownSeconds: 120 } });
    expect(row(commanderView(m, 'nato'))).toMatchObject({ readyIn: 120, cooldown: 120, radius: 10 });
    expect(row(commanderView(m, 'nato')).off).toBeUndefined();
    for (let i = 0; i < 120 * HZ - 1; i++) step(m, []);
    expect(rejections(step(m, [feint(m, SPOT)]))).toEqual(['cooling down']);
    expect(rejections(step(m, [feint(m, SPOT)]))).toEqual([]);
  });

  it('comes down under its canopy for 5 s ("Decoy inbound", then "Decoy active"), fakes gunfire 30 s and goes', () => {
    const m = scene();
    const run = play(m, FALL + 31, [feint(m, { x: 100, y: 50 })]);
    expect(radio(run)).toEqual([
      { tick: 0, text: 'Decoy inbound' },
      { tick: FALL * HZ, text: 'Decoy active' },
    ]);
    expect(effect(run.views[0]!)).toMatchObject({ x: 100, y: 50, radius: 10, landsIn: FALL - 1 / HZ, fall: FALL, total: FALL + 30, side: 'nato' });
    expect(effect(run.views[FALL * HZ]!)).toMatchObject({ landsIn: 0 });
    expect(effect(run.views[(FALL + 30) * HZ - 2]!)).toBeTruthy();
    expect(effect(run.views[(FALL + 30) * HZ]!)).toBeUndefined();
  });
});

/** The heard sighting Squad `sq` has of the dummy at the spot, if any. */
const heardAt = (m: Match, sq: number, at: Vec2 = SPOT) => m.squads[sq]!.memory.find((s) => s.source === 'heard' && s.x === at.x && s.y === at.y);
const ring = (at: Vec2, r: number, ids: number[]) => Object.fromEntries(ids.map((id, i) => [id, { x: at.x + (i - 1.5) * 3, y: at.y + r, fx: 0, fy: 1 }]));

describe('Feint: the firecrackers', () => {
  it('from its landing, a burst every 2 s for 30 s: heard by an enemy Squad 60 m off, never by the caller\'s own Squads', () => {
    const m = scene({ ...ring(SPOT, -60, [0, 1, 2, 3]), ...ring(SPOT, 60, [4, 5, 6, 7]) });
    const bursts = new Set<number>();
    play(m, FALL + 31, [feint(m, SPOT)], () => {
      const s = heardAt(m, 1);
      if (s) bursts.add(s.tick);
      expect(heardAt(m, 0)).toBeUndefined();
    });
    expect([...bursts]).toEqual(Array.from({ length: 15 }, (_, k) => (FALL + 2 * k) * HZ));
  });

  it('an enemy Squad that hears it bounds instead of walking, and walks again once it falls silent', () => {
    const m = scene(ring(SPOT, 60, [4, 5, 6, 7]));
    const modes: string[] = [];
    play(m, FALL + 40, [feint(m, SPOT)], () => modes.push(m.squads[1]!.mode));
    expect(modes[(FALL - 1) * HZ]).toBe('travel');
    expect(modes.slice((FALL + 2) * HZ, (FALL + 30) * HZ).every((s) => s === 'bound')).toBe(true);
    expect(modes.at(-1)).toBe('travel');
  });

  it('a Squad farther than hearM hears nothing', () => {
    const m = scene(ring(SPOT, DEFAULT_TUNE.hearM + 10, [4, 5, 6, 7]));
    play(m, FALL + 10, [feint(m, SPOT)], () => expect(heardAt(m, 1)).toBeUndefined());
    expect(m.squads[1]!.mode).toBe('travel');
  });
});

describe('Feint: fire back', () => {
  const suppressive = (r: Run) => r.events.filter((e): e is Extract<Stamped, { kind: 'suppressive' }> => e.kind === 'suppressive' && e.side === 'pact');
  const ammo = (v: CommanderView) => Math.min(...v.friendlies.map((f) => f.ammo!));

  it('a suppressed enemy Squad with nothing seen fires suppressive at the dummy, and its ammunition drops', () => {
    const m = scene(ring(SPOT, 60, [4, 5, 6, 7]));
    const run = play(m, FALL + 12, [feint(m, SPOT)], () => {
      for (const id of [4, 5, 6, 7]) m.soldiers[id]!.suppression = 0.4; // pinned down from somewhere else all along
    });
    const shots = suppressive(run);
    expect(shots.length).toBeGreaterThan(10);
    expect(shots[0]!.tick).toBeGreaterThanOrEqual(FALL * HZ); // nothing to fire at before it went off
    for (const e of shots) expect(Math.abs(e.x) + Math.abs(e.y)).toBeLessThanOrEqual(2 * DEFAULT_TUNE.suppressiveScatterM);
    expect(ammo(run.pact.at(-1)!)).toBeLessThan(1);
  });

  it('holds its fire unsuppressed', () => {
    const m = scene(ring(SPOT, 60, [4, 5, 6, 7]));
    const run = play(m, FALL + 12, [feint(m, SPOT)]);
    expect(suppressive(run)).toEqual([]);
    expect(ammo(run.pact.at(-1)!)).toBe(1);
  });
});

describe('Feint: skirted', () => {
  // On the river field, from nato's HQ E is 415 m over the north footbridge and 441 m over the centre bridge. nato's Squad 0
  // stands over on E's bank 60 m from the footbridge; Squad 1 picks its way to E from the HQ once pact's dummy has gone off there.
  const toE: MapData = { ...RIVER_FIELD, points: RIVER_FIELD.points.filter((p) => p.id === 'E') };
  function routeOf(called: boolean) {
    const tune: Tune = { ...DEFAULT_TUNE, squadSize: 2, speedJitter: 0, spread: 0, walkSpeed: 0, visionM: 50, routeJitterM: 0, feintCooldownSeconds: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, ...NO_TRAITS, ...NO_TEMPO };
    const m = thinkOnId(createMatch({ seed: 2, map: toE, tune, squadsPerSide: 2, commanderSide: 'nato' }));
    for (const [id, y] of [[0, 128], [1, 132]] as const) Object.assign(m.soldiers[id]!, { x: 60, y });
    m.squads[1]!.nextThink = (FALL + 1) * HZ;
    play(m, FALL + 2, called ? [feint(m, { x: 0, y: 120 }, 'pact')] : []);
    return m.map.crossings![m.squads[1]!.route]?.id;
  }

  it('a Squad picking its way over the river skirts the crossing where its Side hears the dummy', () => {
    expect(routeOf(false)).toBe('N');
    expect(routeOf(true)).toBe('C');
  });
});

describe('Feint: no lure', () => {
  // pact's Squad stands on its own E, quiet, and goes for nato's A; the dummy goes off 60 m from E, within E's threatened ring
  const E = { x: 300, y: 0 };
  const goal = (m: Match) => m.points[m.squads[1]!.goal]?.id;

  it('an own Capture Point with the dummy going off by it is not threatened: the Squad on it still leaves, as it would not for real fire', () => {
    const m = scene(ring(E, 0, [4, 5, 6, 7]));
    play(m, FALL + 4, [feint(m, { x: 300, y: 60 })]);
    expect(heardAt(m, 1, { x: 300, y: 60 })).toBeTruthy();
    expect(goal(m)).toBe('A');
    const real = scene(ring(E, 0, [4, 5, 6, 7]));
    play(real, FALL + 4, [], () => real.squads[1]!.memory.splice(0, 1, { id: 0, x: 300, y: 60, tick: real.tick, source: 'heard' })); // nato's 0 firing from there
    expect(goal(real)).toBe('E');
  });
});

describe('Feint: the Consoles', () => {
  it('neither Console is shown its fake shots: the caller\'s sees a pulse every burst, the enemy\'s nothing of them', () => {
    const m = scene(ring(SPOT, 60, [4, 5, 6, 7]));
    const shown: Record<SideId, SimEvent[]> = { nato: [], pact: [] };
    const pulses: (number | undefined)[] = [];
    for (let i = 0; i < (FALL + 5) * HZ; i++) {
      const events = step(m, i ? [] : [feint(m, SPOT)]);
      for (const side of ['nato', 'pact'] as const) shown[side].push(...commanderEvents(m, side, events));
      pulses.push(effect(commanderView(m, 'nato'))!.burst);
    }
    for (const side of ['nato', 'pact'] as const) expect(shown[side].filter((e) => e.kind === 'shot' || e.kind === 'suppressive')).toEqual([]);
    expect(pulses[FALL * HZ - 1]).toBeUndefined(); // still in the air
    expect(pulses[FALL * HZ]).toBeCloseTo(1 / HZ); // the first burst, as it lands ...
    expect(pulses[(FALL + 2) * HZ - 1]).toBeCloseTo(2); // ... the next 2 s on
    expect(pulses[(FALL + 2) * HZ]).toBeCloseTo(1 / HZ);
  });

  it('the enemy\'s Console carries it while it falls (the sky rule), then only while one of its Soldiers sees it, and never its pulse', () => {
    const away = scene(ring(SPOT, 60, [4, 5, 6, 7]));
    const run = play(away, FALL + 2, [feint(away, SPOT)]);
    expect(effect(run.pact[HZ]!)).toMatchObject({ side: 'nato', landsIn: FALL - 1 - 1 / HZ });
    expect(effect(run.pact.at(-1)!)).toBeUndefined();
    const near = scene({ ...ring(SPOT, 60, [4, 5, 6, 7]), 4: { x: 0, y: 30, fx: 0, fy: -1 } });
    const seen = play(near, FALL + 2, [feint(near, SPOT)]);
    expect(effect(seen.pact.at(-1)!)).toMatchObject({ side: 'nato', landsIn: 0 });
    expect(effect(seen.pact.at(-1)!)!.burst).toBeUndefined();
  });
});

describe('Feint: seen for what it is', () => {
  // Two pact Squads hear it from 60 m, north (Squad 2) and south (Squad 3); one of Squad 2's Soldiers stands 30 m from it.
  const twoSquads = () => scene({ ...ring(SPOT, 60, [8, 9, 10, 11]), 8: { x: 0, y: 30, fx: 0, fy: -1 }, ...ring(SPOT, -60, [12, 13, 14, 15]) }, { squads: 2 });

  it('an enemy Soldier who sees the landed dummy stops its Squad reacting; another Squad out of sight keeps reacting', () => {
    const m = twoSquads();
    const run = play(m, FALL + 20, [feint(m, SPOT)]);
    expect(heardAt(m, 2)).toBeUndefined(); // dropped from its memory, and never heard again
    expect(m.squads[2]!.mode).toBe('travel');
    expect(heardAt(m, 3)).toBeTruthy();
    expect(m.squads[3]!.mode).toBe('bound');
    expect(run.events.filter((e) => e.kind === 'suppressive' && e.side === 'pact')).toEqual([]); // nobody was under fire
  });

  it('is never seen through while it falls: a parachute coming down is a paratrooper to anyone', () => {
    const m = twoSquads();
    play(m, FALL - 1, [feint(m, SPOT)]);
    expect(m.squads[2]!.dud).toEqual([]);
  });

  it('is hashed: who has seen through it moves the state hash, and so does the dummy dropped', () => {
    const [a, b] = [twoSquads(), twoSquads()];
    play(a, FALL + 1, [feint(a, SPOT)]);
    play(b, FALL + 1, [feint(b, SPOT)]);
    expect(stateHash(a)).toBe(stateHash(b));
    b.squads[3]!.dud.push(1);
    expect(stateHash(a)).not.toBe(stateHash(b));
    a.assets.dummies++;
    expect(stateHash(a)).not.toBe(stateHash(twoSquads()));
  });
});
