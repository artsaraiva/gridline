import { describe, expect, it } from 'vitest';
import { commanderEvents, commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;
const AT: Vec2 = { x: 100, y: 50 };
const ZONE = 40; // the danger zone: shells land within 25 m, and suppress out to 15 m past that

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

type Placement = { x: number; y: number };

/** nato Soldiers 0..n-1, pact n..2n-1. Placing Soldiers stands in for a map script; everything after runs through `step`. Nobody fires. */
function scene(place: Record<number, Placement> = {}, tune: Partial<Tune> = {}, seed = 1, map: MapData = field): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, barrageCooldownSeconds: 0, ...tune };
  const m = createMatch({ seed, map, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const barrage = (m: Match, at: Vec2 = AT): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'barrage', at });

type Stamped = SimEvent & { tick: number };
interface Run {
  events: Stamped[];
  views: CommanderView[]; // nato's view after each step; views[i] follows the step of tick i
  pact: CommanderView[];
}

/** Calls the Barrage on tick 0, then steps `ticks` in all. */
function play(m: Match, ticks: number, at: Vec2 = AT): Run {
  const run: Run = { events: [], views: [], pact: [] };
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    run.events.push(...step(m, i === 0 ? [barrage(m, at)] : []).map((e) => ({ ...e, tick })));
    run.views.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

const impacts = (r: Run) => r.events.filter((e): e is Extract<Stamped, { kind: 'impact' }> => e.kind === 'impact');
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));
const SHELLS_DONE = 16 * HZ;

/** Where the shells land with `tune`, found by a dry run on the same seed: the spots are drawn when it is called. */
const landings = (tune: Partial<Tune> = {}, seed = 1) => impacts(play(scene({}, tune, seed), SHELLS_DONE));

describe('Artillery Barrage: the call', () => {
  it('starts on cooldown: first ready at 2:00, rejected until then', () => {
    const m = createMatch({ seed: 1, map: field, tune: DEFAULT_TUNE, squadsPerSide: 1, commanderSide: 'nato' });
    const readyIn = () => commanderView(m, 'nato').assets!.find((a) => a.asset === 'barrage')!;
    expect(readyIn()).toMatchObject({ readyIn: 120, cooldown: 120, radius: ZONE });
    for (let i = 0; i < 120 * HZ - 1; i++) step(m, []);
    expect(rejections(step(m, [barrage(m)]))).toEqual(['cooling down']);
    expect(readyIn().readyIn).toBe(0);
    expect(rejections(step(m, [barrage(m)]))).toEqual([]);
  });

  it('the cooldown is 120 s from the call', () => {
    const m = scene({}, { barrageCooldownSeconds: 120 });
    for (let i = 0; i < 120 * HZ; i++) step(m, []);
    step(m, [barrage(m)]);
    expect(commanderView(m, 'nato').assets!.find((a) => a.asset === 'barrage')!.readyIn).toBeCloseTo(120 - 1 / HZ);
  });

  it('is rejected outside the Play Area and on the enemy HQ', () => {
    const m = scene();
    expect(rejections(step(m, [barrage(m, { x: 0, y: 700 })]))).toEqual(['outside the Play Area']);
    expect(rejections(step(m, [barrage(m, { x: 560, y: 0 })]))).toEqual(['on the enemy HQ']);
  });

  it('radios "Barrage inbound" with the grid at the call, then "Splash" at the first impact', () => {
    const run = play(scene(), SHELLS_DONE);
    const lines = run.events.filter((e) => e.kind === 'radio');
    expect(lines).toMatchObject([
      { side: 'nato', squad: null, text: 'Barrage inbound', grid: 'H6', tick: 0 },
      { side: 'nato', squad: null, text: 'Splash', tick: impacts(run)[0]!.tick },
    ]);
  });
});

describe('Artillery Barrage: the shells', () => {
  it('six shells, seeded within 25 m of the spot: the first lands 5 s + 1.5 s after the call, the rest over 8 s', () => {
    const hits = landings();
    expect(hits).toHaveLength(6);
    expect(hits[0]!.tick).toBe(6.5 * HZ);
    expect(hits[5]!.tick - hits[0]!.tick).toBe(8 * HZ);
    for (const h of hits) expect(dist(h, AT)).toBeLessThanOrEqual(25);
    expect(new Set(hits.map((h) => `${h.x},${h.y}`)).size).toBe(6);
  });

  it('the same seed drops them on the same spots, another seed elsewhere', () => {
    const spots = (seed: number) => landings({}, seed).map((h) => [h.x, h.y]);
    expect(spots(1)).toEqual(spots(1));
    expect(spots(2)).not.toEqual(spots(1));
  });

  it('are projectiles: in the air for 1.5 s with their landing spot in the view, and harmless until they land', () => {
    const [first] = landings();
    const m = scene({ 6: { x: first!.x, y: first!.y } }); // pact Soldier 6, on the first landing spot
    const run = play(m, 8 * HZ);
    const air = (i: number) => run.views[i]!.effects![0]!.shells!;
    expect(air(4 * HZ)).toEqual([]); // 4 s: nothing has left yet
    expect(air(5 * HZ + 1)).toMatchObject([{ x: first!.x, y: first!.y }]); // launched
    expect(air(5 * HZ + 1)[0]!.flight).toBeGreaterThan(0);
    expect(air(5 * HZ + 15)[0]!.flight).toBeGreaterThan(air(5 * HZ + 1)[0]!.flight);
    const hit = first!.tick;
    for (let i = 5 * HZ; i < hit; i++) expect(run.pact[i]!.friendlies.find((f) => f.id === 6)).toMatchObject({ state: 'alive', suppressed: false });
    expect(run.pact[hit]!.friendlies.find((f) => f.id === 6)).toBeUndefined(); // dead on the landing tick
  });

  it('kill within 5 m, Wound to 8 m, suppress to 15 m, and nothing beyond; each death costs a Ticket', () => {
    const [first] = landings({ barrageShells: 1 });
    const offsets = [4.9, 5.1, 7.9, 8.1, 14.9, 15.1];
    const place = Object.fromEntries(offsets.map((d, i) => [6 + i, { x: first!.x + d, y: first!.y }]));
    const m = scene(place, { barrageShells: 1 });
    const run = play(m, first!.tick + 1);
    const after = run.pact.at(-1)!;
    const state = (id: number) => {
      const f = after.friendlies.find((o) => o.id === id);
      return f ? `${f.state}${f.suppressed ? ' suppressed' : ''}` : 'dead';
    };
    expect(offsets.map((_, i) => state(6 + i))).toEqual(['dead', 'wounded', 'wounded', 'alive suppressed', 'alive suppressed', 'alive']);
    expect(after.tickets.pact).toBe(DEFAULT_TUNE.tickets - 1);
  });

  it('friendly fire is on: a friendly that cannot get out is killed', () => {
    const [first] = landings({ barrageShells: 1, walkSpeed: 0 });
    const m = scene({ 0: { x: first!.x + 3, y: first!.y } }, { barrageShells: 1, walkSpeed: 0 });
    const run = play(m, first!.tick + 1);
    expect(run.views.at(-1)!.friendlies.some((f) => f.id === 0)).toBe(false);
    expect(run.views.at(-1)!.tickets.nato).toBe(DEFAULT_TUNE.tickets - 1);
  });
});

describe('Artillery Barrage: fleeing', () => {
  const pos = (v: CommanderView, id: number) => v.friendlies.find((f) => f.id === id)!;

  it('friendlies in the zone run out of it as soon as it is called, and are clear before the shells land', () => {
    const m = scene({ 0: { x: AT.x + 5, y: AT.y }, 1: { x: AT.x - 20, y: AT.y + 10 } });
    const run = play(m, 16 * HZ);
    for (const id of [0, 1]) {
      const d = (i: number) => dist(pos(run.views[i]!, id), AT);
      expect(d(1 * HZ)).toBeGreaterThan(d(0));
      expect(d(2 * HZ)).toBeGreaterThan(d(1 * HZ));
      expect(d(6 * HZ + 10)).toBeGreaterThanOrEqual(ZONE); // clear by the first landing, 6.5 s
      expect(pos(run.views.at(-1)!, id).state).toBe('alive');
    }
    expect(impacts(run).length).toBe(6);
  });

  it('enemies in the zone stand until the first shell lands, then run out of it', () => {
    // the shells themselves are made harmless here, so the enemy lives to run
    const harmless = { barrageKillM: 0, barrageWoundM: 0 };
    const start = { x: AT.x + 20, y: AT.y };
    const run = play(scene({ 6: start }, harmless), 14 * HZ);
    const at = (i: number) => run.pact[i]!.friendlies.find((f) => f.id === 6)!;
    const first = impacts(run)[0]!.tick;
    for (let i = 0; i < first; i++) expect(dist(at(i), start)).toBe(0);
    expect(dist(at(first + 2 * HZ), AT)).toBeGreaterThan(dist(start, AT) + 5);
    expect(dist(at(14 * HZ - 1), AT)).toBeGreaterThanOrEqual(ZONE);
  });

  it('Soldiers outside the zone stand where they are', () => {
    const run = play(scene({ 6: { x: AT.x + 60, y: AT.y } }), 10 * HZ);
    expect(dist(pos(run.pact.at(-1)!, 6), { x: AT.x + 60, y: AT.y })).toBe(0);
  });

  it('a Squad on its way to a point in the zone is held outside it while the Barrage works, then goes in', () => {
    const P = { id: 'P', name: 'P', x: AT.x, y: AT.y, owner: null };
    const place = Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [i, { x: AT.x - 70, y: AT.y + i * 3 }]));
    const run = play(scene(place, {}, 1, { ...field, points: [P] }), 30 * HZ);
    const nearest = (i: number) => Math.min(...run.views[i]!.friendlies.map((f) => dist(f, AT)));
    expect(nearest(10 * HZ)).toBeGreaterThanOrEqual(ZONE); // held at the edge
    expect(nearest(15 * HZ)).toBeGreaterThanOrEqual(ZONE);
    expect(nearest(30 * HZ - 1)).toBeLessThan(25); // the Barrage is over: it carries on to the point
  });
});

describe('Artillery Barrage: Contacts', () => {
  const shell = (): { first: Extract<Stamped, { kind: 'impact' }>; tune: Partial<Tune> } => ({ first: landings({ barrageShells: 1, walkSpeed: 0 })[0]!, tune: { barrageShells: 1, walkSpeed: 0 } });

  it('enemies inside the zone are Contacts from the first impact until 2 s after the last, never before and never outside', () => {
    const { first, tune } = shell();
    const inside = { x: first.x + 12, y: first.y };
    const outside = { x: AT.x + ZONE + 5, y: AT.y };
    const friend = { x: first.x - 12, y: first.y }; // a friendly in the zone is no Contact
    const run = play(scene({ 0: friend, 6: inside, 7: outside }, { ...tune, visionM: 0 }), first.tick + 4 * HZ); // nobody sees anything: only the Barrage shows them
    const seen = (i: number) => run.views[i]!.contacts.map((c) => c.id);
    for (let i = 0; i < first.tick; i++) expect(seen(i)).toEqual([]);
    const shown = run.views.map((_, i) => i).filter((i) => seen(i).length);
    expect(shown.map(seen).flat().every((id) => id === 6)).toBe(true);
    expect(shown[0]).toBe(first.tick); // the view after the landing step
    expect(shown).toHaveLength(shown.at(-1)! - shown[0]! + 1); // no gap
    expect((shown.at(-1)! - first.tick) / HZ).toBeGreaterThanOrEqual(1.9);
    expect((shown.at(-1)! - first.tick) / HZ).toBeLessThanOrEqual(2.05);
    expect(run.views.at(-1)!.lastKnown).toEqual([]);
  });

  it('show position and facing only, as any Contact does', () => {
    const { first, tune } = shell();
    const run = play(scene({ 6: { x: first.x + 12, y: first.y } }, tune), first.tick + 2);
    expect(Object.keys(run.views.at(-1)!.contacts[0]!).sort()).toEqual(['fx', 'fy', 'id', 'x', 'y']);
  });

  it('the impacts reach the Commander who called them, and nobody else', () => {
    const m = scene();
    const events: SimEvent[] = [];
    for (let i = 0; i < SHELLS_DONE; i++) events.push(...step(m, i === 0 ? [barrage(m)] : []));
    expect(commanderEvents(m, 'nato', events).filter((e) => e.kind === 'impact')).toHaveLength(6);
    expect(commanderEvents(m, 'pact', events).filter((e) => e.kind === 'impact')).toHaveLength(0);
  });
});
