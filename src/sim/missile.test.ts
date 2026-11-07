import { describe, expect, it } from 'vitest';
import { commanderEvents, commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Kaltenbach's shape in the open: HQs 415 m out on the flanks, the Play Area edge 456 m out, the middle point C at the centre. */
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -456, y: -456 },
    { x: 456, y: -456 },
    { x: 456, y: 456 },
    { x: -456, y: 456 },
  ],
  hqs: { nato: { x: -415, y: 0 }, pact: { x: 415, y: 0 } },
  points: [
    { id: 'B', name: 'B', x: 0, y: 300 },
    { id: 'C', name: 'C', x: 0, y: 0, owner: 'nato' },
    { id: 'D', name: 'D', x: 0, y: -300 },
  ],
  grid: { cols: 12, rows: 12, squareM: 76, letters: 'ABCDEFGHIJKL' },
};

type Placement = { x: number; y: number };

/** nato Soldiers 0..n-1, pact n..2n-1, stood where placed (else at their HQ); nobody fires or walks unless told. */
function scene(place: Record<number, Placement> = {}, tune: Partial<Tune> = {}, seed = 1, map: MapData = field): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, walkSpeed: 0, missileCooldownSeconds: 0, boardMinM: Infinity, ...tune }; // #107: nobody boards the tank
  const m = createMatch({ seed, map, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const missile = (m: Match, at: Vec2, side: 'nato' | 'pact' = 'nato'): Command => ({ tick: m.tick, side, kind: 'asset', asset: 'missile', at });

type Stamped = SimEvent & { tick: number };
interface Run {
  events: Stamped[];
  views: CommanderView[]; // nato's view after each step; views[i] follows the step of tick i
  pact: CommanderView[];
}

/** Calls the missile at `at` on tick 0, then steps `ticks` in all. */
function play(m: Match, ticks: number, at: Vec2): Run {
  const run: Run = { events: [], views: [], pact: [] };
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    run.events.push(...step(m, i === 0 ? [missile(m, at)] : []).map((e) => ({ ...e, tick })));
    run.views.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

const impacts = (r: Run) => r.events.filter((e): e is Extract<Stamped, { kind: 'impact' }> => e.kind === 'impact');
const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));
const row = (v: CommanderView) => v.assets!.find((a) => a.asset === 'missile')!;
const effect = (v: CommanderView) => v.effects!.find((e) => e.asset === 'missile');

describe('Cruise Missile: the call', () => {
  it('starts on cooldown: first ready at 4:00 with a 35 m zone, rejected until then', () => {
    const m = scene({}, { missileCooldownSeconds: 240 });
    expect(row(commanderView(m, 'nato'))).toMatchObject({ readyIn: 240, cooldown: 240, radius: 35 });
    for (let i = 0; i < 240 * HZ - 1; i++) step(m, []);
    expect(rejections(step(m, [missile(m, { x: 100, y: 0 })]))).toEqual(['cooling down']);
    expect(row(commanderView(m, 'nato')).readyIn).toBe(0);
    expect(rejections(step(m, [missile(m, { x: 100, y: 0 })]))).toEqual([]);
  });

  it('needs the middle Capture Point: without it the row says so, Confirm is refused, and the cooldown still runs', () => {
    const m = scene({}, { missileCooldownSeconds: 240 });
    m.points.find((p) => p.id === 'C')!.owner = null;
    expect(row(commanderView(m, 'nato'))).toMatchObject({ off: 'needs C', readyIn: 240 });
    for (let i = 0; i < 240 * HZ; i++) step(m, []);
    expect(row(commanderView(m, 'nato'))).toMatchObject({ off: 'needs C', readyIn: 0 });
    expect(rejections(step(m, [missile(m, { x: 100, y: 0 })]))).toEqual(['needs C']);
    m.points.find((p) => p.id === 'C')!.owner = 'nato';
    expect(row(commanderView(m, 'nato')).off).toBeUndefined();
    expect(rejections(step(m, [missile(m, { x: 100, y: 0 })]))).toEqual([]);
  });

  it('with the gate tuned off (review scenes), it needs no point at all', () => {
    const m = scene({}, { missileGated: false });
    m.points.find((p) => p.id === 'C')!.owner = 'pact';
    expect(row(commanderView(m, 'nato')).off).toBeUndefined();
    expect(rejections(step(m, [missile(m, { x: 100, y: 0 })]))).toEqual([]);
  });
});

describe('Cruise Missile: the flight', () => {
  it('leaves at once from beyond the Play Area behind the own HQ, on the line from the map centre through it, 1100 m out, at 70 m/s', () => {
    const run = play(scene(), 30 * HZ, { x: 370, y: 0 }); // just short of the enemy HQ ring (no Asset lands on it)
    const e0 = effect(run.views[0]!)!;
    expect(e0.from!.y).toBe(0);
    expect(e0.from!.x).toBe(-1556); // 1100 m beyond the west edge at -456, behind nato's HQ at -415
    expect(e0.flight).toBeGreaterThan(0);
    expect(e0.flight).toBeLessThan(0.01);
    expect(e0.impactIn).toBeCloseTo((370 - e0.from!.x) / 70 - 1 / HZ, 1);
    expect(effect(run.views[10 * HZ]!)!.flight).toBeGreaterThan(effect(run.views[5 * HZ]!)!.flight!);
  });

  it('lands about 27.5 s after confirm at the far HQ edge and about 22 s at the map centre', () => {
    const far = impacts(play(scene(), 30 * HZ, { x: 370, y: 0 }));
    expect(far).toHaveLength(1);
    expect(far[0]!.tick / HZ).toBeGreaterThan(26.5);
    expect(far[0]!.tick / HZ).toBeLessThan(28.5);
    expect(far[0]).toMatchObject({ side: 'nato', x: 370, y: 0 });
    const centre = impacts(play(scene(), 30 * HZ, { x: 0, y: 0 }));
    expect(centre[0]!.tick / HZ).toBeGreaterThan(21);
    expect(centre[0]!.tick / HZ).toBeLessThan(23);
  });

  it('is in the sky: both Sides see it from launch to impact, with its caller, and it goes 2 s after the hit', () => {
    const run = play(scene(), 30 * HZ, { x: 0, y: 0 });
    const hit = impacts(run)[0]!.tick;
    for (let i = 0; i < hit; i++) {
      expect(effect(run.pact[i]!)).toEqual(effect(run.views[i]!));
      expect(effect(run.pact[i]!)).toMatchObject({ side: 'nato', from: effect(run.views[0]!)!.from });
    }
    expect(effect(run.views[hit]!)).toMatchObject({ flight: 1, impactIn: 0 });
    expect(effect(run.views[hit + 2 * HZ - 2]!)).toBeDefined();
    expect(effect(run.views[hit + 2 * HZ]!)).toBeUndefined();
  });

  it('losing the middle point mid-flight changes nothing: the missile lands', () => {
    const m = scene();
    step(m, [missile(m, { x: 0, y: 0 })]);
    m.points.find((p) => p.id === 'C')!.owner = 'pact';
    const events: Stamped[] = [];
    for (let i = 0; i < 30 * HZ; i++) events.push(...step(m, []).map((e) => ({ ...e, tick: m.tick - 1 })));
    expect(events.filter((e) => e.kind === 'impact')).toHaveLength(1);
  });

  it('radios "Missile away" at the call and "Splash" at the hit, to the caller only', () => {
    const m = scene();
    const events: Stamped[] = [];
    for (let i = 0; i < 30 * HZ; i++) events.push(...step(m, i === 0 ? [missile(m, { x: 0, y: 0 })] : []).map((e) => ({ ...e, tick: m.tick - 1 })));
    const hit = events.find((e) => e.kind === 'impact')!.tick;
    expect(events.filter((e) => e.kind === 'radio')).toMatchObject([
      { side: 'nato', squad: null, text: 'Missile away', grid: expect.any(String), tick: 0 },
      { side: 'nato', squad: null, text: 'Splash', tick: hit },
    ]);
    expect(commanderEvents(m, 'pact', events).filter((e) => e.kind === 'impact' || e.kind === 'radio')).toEqual([]);
  });
});

describe('Cruise Missile: the blast', () => {
  const AT = { x: 0, y: 0 };
  const state = (v: CommanderView, id: number) => {
    const f = v.friendlies.find((o) => o.id === id);
    return f ? `${f.state}${f.suppressed ? ' suppressed' : ''}` : 'dead';
  };

  it('kills within 12 m, Wounds to 20 m, suppresses fully to 35 m and nothing beyond, Soldiers of either Side; each death costs a Ticket', () => {
    const offsets = [11.9, 12.1, 19.9, 20.1, 34.9, 35.1];
    const place = Object.fromEntries(offsets.map((d, i) => [6 + i, { x: AT.x + d, y: AT.y }]));
    place[0] = { x: AT.x - 5, y: AT.y }; // a friendly in the blast: the Commander's mistake
    const m = scene(place);
    const run = play(m, 26 * HZ, AT);
    const hit = impacts(run)[0]!.tick;
    const before = run.pact[hit - 1]!;
    expect(offsets.map((_, i) => state(before, 6 + i))).toEqual(Array(6).fill('alive')); // harmless until it lands
    const after = run.pact[hit]!;
    expect(offsets.map((_, i) => state(after, 6 + i))).toEqual(['dead', 'wounded', 'wounded', 'alive suppressed', 'alive suppressed', 'alive']);
    expect(state(run.pact[hit + 3 * HZ]!, 10)).toBe('alive suppressed'); // full suppression: still suppressed 3 s on
    expect(after.tickets.pact).toBe(before.tickets.pact - 1); // (the held middle point drains pact's Tickets meanwhile)
    expect(state(run.views[hit]!, 0)).toBe('dead');
    expect(run.views[hit]!.tickets.nato).toBe(run.views[hit - 1]!.tickets.nato - 1);
  });

  it('scores the caller artillery points per enemy Soldier it kills, as a Barrage shell does, never for a friendly', () => {
    const m = scene({ 0: { x: AT.x + 3, y: AT.y }, 6: { x: AT.x - 3, y: AT.y }, 7: { x: AT.x + 15, y: AT.y } });
    const run = play(m, 23 * HZ, AT);
    const awards = run.events.filter((e) => e.kind === 'award');
    expect(awards).toMatchObject([{ side: 'nato', category: 'artillery', points: DEFAULT_TUNE.scoreArtilleryKill, reason: 'Missile kill' }]);
    expect(run.views.at(-1)!.score).toMatchObject({ artillery: DEFAULT_TUNE.scoreArtilleryKill });
    // the Wounded enemy bleeds out: that death is the missile's too
    for (let i = 0; i < 10 * HZ; i++) step(m, []);
    expect(commanderView(m, 'nato').score!.artillery).toBe(2 * DEFAULT_TUNE.scoreArtilleryKill);
  });

  it('shows the enemies in the 35 m zone as Contacts for 2 s after the hit, never before and never outside', () => {
    const run = play(scene({ 6: { x: AT.x + 25, y: AT.y }, 7: { x: AT.x + 40, y: AT.y } }, { visionM: 0, missileKillM: 0, missileWoundM: 0 }), 26 * HZ, AT);
    const hit = impacts(run)[0]!.tick;
    const seen = (i: number) => run.views[i]!.contacts.map((c) => c.id);
    for (let i = 0; i < hit; i++) expect(seen(i)).toEqual([]);
    const shown = run.views.map((_, i) => i).filter((i) => seen(i).length);
    expect(shown[0]).toBe(hit);
    expect(shown.every((i) => seen(i).length === 1 && seen(i)[0] === 6)).toBe(true);
    expect((shown.at(-1)! - hit) / HZ).toBeGreaterThanOrEqual(1.9);
    expect((shown.at(-1)! - hit) / HZ).toBeLessThanOrEqual(2.05);
  });

  it('the flight and what it did to a Soldier are part of the state hash', () => {
    const m = scene({ 6: { x: AT.x + 15, y: AT.y } }); // pact 6 in the Wound ring
    step(m, [missile(m, AT)]);
    const e = m.assets.effects[0]!;
    for (const [field, nudge] of [['land', 1], ['launch', -1]] as const) {
      const h = stateHash(m);
      (e as unknown as Record<string, number>)[field]! += nudge;
      expect(stateHash(m), field).not.toBe(h);
      (e as unknown as Record<string, number>)[field]! -= nudge;
    }
    const h = stateHash(m);
    e.from!.x += 1;
    expect(stateHash(m)).not.toBe(h);
    e.from!.x -= 1;
    for (let i = 0; i < 30 * HZ; i++) step(m, []);
    expect(m.soldiers[6]!.cause).toBe('missile');
    const hit = stateHash(m);
    m.soldiers[6]!.cause = 'barrage';
    expect(stateHash(m)).not.toBe(hit);
  });

  it('a seeded replay lands on the same tick with the same casualties and state every run', () => {
    const go = () => {
      const m = scene({ 6: { x: AT.x + 5, y: AT.y } }, { fireRangeM: 140, walkSpeed: 5 });
      const run = play(m, 30 * HZ, AT);
      return { hit: impacts(run)[0]!.tick, deaths: run.events.flatMap((e) => (e.kind === 'death' ? [[e.tick, e.id]] : [])), hash: stateHash(m) };
    };
    expect(go()).toEqual(go());
  });
});
