import { describe, expect, it } from 'vitest';
import { crateFlow, crateReachM, flowDist } from './ai/flow';
import { commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, Command, MapData, SideId, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;
const { ammo: FULL, hp: FULL_HP } = DEFAULT_TUNE;

/** Open ground 1200 m across, HQs far out on the flanks. `own` is a nato point: Squads with nothing else to do hold it. */
const field = (points: MapData['points'] = []): MapData => ({
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points,
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
});

type Placement = { x?: number; y?: number; ammo?: number; hp?: number };

/** Placing Soldiers (and their ammo and health) stands in for a map script; everything after runs through `step`. Nobody sees anybody. */
function scene(place: Record<number, Placement> = {}, o: { tune?: Partial<Tune>; squads?: number; squadSize?: number; points?: MapData['points'] } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: o.squadSize ?? 1, speedJitter: 0, spread: 0, visionM: 0, jetsPerSide: 0, aasPerSide: 0, rideM: [180, 180], ...o.tune };
  const m = createMatch({ seed: 1, map: field(o.points), tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const drop = (m: Match, at: Vec2, side: SideId = 'nato'): Command => ({ tick: m.tick, side, kind: 'asset', asset: 'supply', at });

function run(m: Match, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(m, []));
  return events;
}

const radio = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'radio' ? [e.text] : []));
const asset = (v: CommanderView) => v.assets!.find((a) => a.asset === 'supply')!;
const crate = (v: CommanderView) => v.effects!.find((e) => e.asset === 'supply');

describe('Supply Drop crate', () => {
  it('is ready at match start; the cooldown is 90 s from the call', () => {
    const m = scene();
    expect(asset(commanderView(m, 'nato'))).toMatchObject({ readyIn: 0, cooldown: 90, radius: 10 });
    step(m, [drop(m, { x: 0, y: 0 })]);
    expect(asset(commanderView(m, 'nato')).readyIn).toBeCloseTo(90 - 1 / HZ);
    run(m, 90 * HZ - 1);
    expect(asset(commanderView(m, 'nato')).readyIn).toBe(0);
  });

  it('falls for 5 s, then stays 60 s, then is gone', () => {
    const m = scene();
    step(m, [drop(m, { x: 0, y: 0 })]);
    expect(crate(commanderView(m, 'nato'))).toMatchObject({ x: 0, y: 0, radius: 10, landsIn: 5 - 1 / HZ, total: 65 });
    run(m, 5 * HZ - 1);
    expect(crate(commanderView(m, 'nato'))!.landsIn).toBe(0);
    expect(crate(commanderView(m, 'nato'))!.left).toBeCloseTo(60);
    run(m, 60 * HZ - 1);
    expect(crate(commanderView(m, 'nato'))).toBeDefined();
    run(m, 1);
    expect(crate(commanderView(m, 'nato'))).toBeUndefined();
  });

  it('radios on the call and again when it lands, naming the grid', () => {
    const m = scene();
    const events = [...step(m, [drop(m, { x: 50, y: 50 })]), ...run(m, 6 * HZ)];
    expect(radio(events)).toEqual(['Supply Drop inbound', 'Supply Drop landed']);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'radio', side: 'nato', squad: null, grid: 'G6' }));
  });

  it('the enemy Commander does not see it', () => {
    const m = scene();
    step(m, [drop(m, { x: 0, y: 0 })]);
    expect(commanderView(m, 'pact').effects).toEqual([]);
  });
});

describe('using the crate', () => {
  // nato 0 at 3 m, nato 1 at 12 m, pact 2 at 3 m from the crate at (0, 0); all low on ammo and wounded
  const low = { ammo: 10, hp: 40 };
  const setup = () => scene({ 0: { x: 3, y: 0, ...low }, 1: { x: 12, y: 0, ...low }, 2: { x: -3, y: 0, ...low } }, { squads: 2, tune: { walkSpeed: 0 } }); // the Squads are short of ammo and would walk to the HQ
  const f = (m: Match, id: number) => commanderView(m, 'nato').friendlies.find((s) => s.id === id)!;

  it('nothing happens while it is still falling', () => {
    const m = setup();
    step(m, [drop(m, { x: 0, y: 0 })]);
    run(m, 4 * HZ);
    expect(f(m, 0).ammo).toBe(10 / FULL);
    expect(m.soldiers[0]!.hp).toBe(40);
  });

  it('friendly Soldiers within 10 m get full ammo; those further out do not', () => {
    const m = setup();
    step(m, [drop(m, { x: 0, y: 0 })]);
    run(m, 6 * HZ);
    expect(f(m, 0).ammo).toBe(1);
    expect(f(m, 1).ammo).toBe(10 / FULL);
  });

  it('heals slowly: some health back after a second, not all, and never past full', () => {
    const m = setup();
    step(m, [drop(m, { x: 0, y: 0 })]);
    run(m, 5 * HZ);
    const at = m.soldiers[0]!.hp;
    run(m, HZ);
    const gained = m.soldiers[0]!.hp - at;
    expect(gained).toBeGreaterThan(0);
    expect(gained).toBeLessThan(10);
    expect(m.soldiers[1]!.hp).toBe(40); // outside the 10 m
    run(m, 55 * HZ);
    expect(m.soldiers[0]!.hp).toBe(FULL_HP);
  });

  it('the enemy cannot use it: a pact Soldier standing in it gets nothing', () => {
    const m = setup();
    step(m, [drop(m, { x: 0, y: 0 })]);
    run(m, 20 * HZ);
    expect(m.soldiers[2]!.ammo).toBe(10);
    expect(m.soldiers[2]!.hp).toBe(40);
  });

  it('a pact crate does nothing for nato', () => {
    const m = setup();
    step(m, [drop(m, { x: 0, y: 0 }, 'pact')]);
    run(m, 20 * HZ);
    expect(f(m, 0).ammo).toBe(10 / FULL);
    expect(m.soldiers[2]!.ammo).toBe(FULL);
  });

  it('stops working when it is gone', () => {
    const m = setup();
    step(m, [drop(m, { x: 0, y: 0 })]);
    run(m, 66 * HZ);
    Object.assign(m.soldiers[0]!, { ammo: 10, hp: 40 });
    run(m, 5 * HZ);
    expect(m.soldiers[0]!.ammo).toBe(10);
  });
});

describe('Squads resupplying', () => {
  // A nato Squad of 4 holds its own point P with 10 rounds each. The HQ is 260 m behind it; a crate lands 50 m off to one side.
  const P = { id: 'P', name: 'P', x: -300, y: 0, owner: 'nato' as const };
  const dry = () => Object.fromEntries([0, 1, 2, 3].map((i) => [i, { x: -300 + i * 3, y: 0, ammo: 10 }]));
  const nearest = (m: Match, to: Vec2) => Math.min(...commanderView(m, 'nato').friendlies.map((f) => Math.sqrt((f.x - to.x) ** 2 + (f.y - to.y) ** 2)));
  const hq = field().hqs.nato;

  /** Runs 150 s with `drops` called on tick 0; how close the Squad got to the HQ and to the crate spot, and its final state. */
  function play(drops: Command[], crateAt: Vec2) {
    const m = scene(dry(), { squadSize: 4, points: [P] });
    let toHq = Infinity;
    let toCrate = Infinity;
    for (let i = 0; i < 150 * HZ; i++) {
      step(m, i === 0 ? drops.map((d) => ({ ...d, tick: 0 })) : []);
      toHq = Math.min(toHq, nearest(m, hq));
      toCrate = Math.min(toCrate, nearest(m, crateAt));
    }
    return { toHq, toCrate, v: commanderView(m, 'nato') };
  }
  const at = { x: -300, y: 50 };

  it('go to a live friendly crate instead of the HQ, get refilled there, then return to the fight', () => {
    const r = play([drop(scene(), at)], at);
    expect(r.toCrate).toBeLessThan(10);
    expect(r.toHq).toBeGreaterThan(DEFAULT_TUNE.hqRadius + 100);
    expect(r.v.friendlies.every((f) => f.ammo === 1)).toBe(true);
    expect(r.v.squads[0]).toMatchObject({ task: 'hold', point: 'P' });
  });

  it('go to the HQ when the only crate is the enemy’s', () => {
    const r = play([drop(scene(), at, 'pact')], at);
    expect(r.toHq).toBeLessThan(DEFAULT_TUNE.hqRadius);
    expect(r.toCrate).toBeGreaterThan(10);
  });

  it('go to the HQ when no crate has been called', () => {
    const r = play([], at);
    expect(r.toHq).toBeLessThan(DEFAULT_TUNE.hqRadius);
  });

  // #156: with no speed jitter here, the crate's field reaches 60 s x 5.06 m/s = 304 m along the walk
  it('#156: go to a crate within its reach though the HQ is nearer, and get refilled there', () => {
    const far = { x: -300, y: 240 };
    const r = play([drop(scene(), far)], far);
    expect(r.toCrate).toBeLessThan(10);
    expect(r.toHq).toBeGreaterThan(DEFAULT_TUNE.hqRadius + 100);
    expect(r.v.friendlies.every((f) => f.ammo === 1)).toBe(true);
  });

  it('#156: go to the HQ when the only crate is past its reach: they could not get there before it goes', () => {
    const beyond = { x: -300, y: 400 };
    const r = play([drop(scene(), beyond)], beyond);
    expect(r.toHq).toBeLessThan(DEFAULT_TUNE.hqRadius);
    expect(r.toCrate).toBeGreaterThan(300);
  });
});

describe('#156: the crate\'s flow field', () => {
  it('reaches as far along the walk as the fastest Soldier walks while the crate stays, and no farther', () => {
    const m = scene({}, { tune: { speedJitter: 0.1 } });
    expect(crateReachM(m)).toBeCloseTo(60 * 5.06 * 1.1); // 334 m
    const f = crateFlow(m, { x: 0, y: 0 });
    expect(flowDist(m, f, { x: crateReachM(m) - 10, y: 0 })).toBeLessThan(Infinity);
    expect(flowDist(m, f, { x: crateReachM(m) + 10, y: 0 })).toBe(Infinity);
    expect(flowDist(m, f, { x: -crateReachM(m) + 10, y: 0 })).toBeLessThan(Infinity);
  });
});
