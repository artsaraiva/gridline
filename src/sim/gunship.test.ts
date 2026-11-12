import { describe, expect, it } from 'vitest';
import { commanderEvents, commanderView, createMatch, stateHash, step, type Match } from './index';
import { look, type Vehicle } from './vehicles';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;
const R = DEFAULT_TUNE.gunshipOrbitM;

/** Kaltenbach's shape in the open: HQs 415 m out on the flanks, the Play Area edge 456 m out, the middle point C (nato's) at the centre. */
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

/**
 * nato Soldiers 0..5, pact 6..11, stood where placed (else at their HQ); nobody fires or walks. `aas`: each Side's AA (nato's
 * vehicle 12, pact's 13), uncrewed. Each Side's Gunship is the last vehicle; nobody takes a seat in it unless `tune` says so.
 */
function scene(place: Record<number, Vec2> = {}, tune: Partial<Tune> = {}, seed = 1, aas = 0): Match {
  const t: Tune = {
    ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, walkSpeed: 0, gunshipCooldownSeconds: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0,
    aasPerSide: aas, pointJeeps: false, crewSpawnChance: 0, paradropChance: 0, ...tune,
  };
  const m = createMatch({ seed, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const gunship = (m: Match, at: Vec2 = { x: 0, y: 0 }): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'gunship', at });
const body = (m: Match, side = 'nato') => m.vehicles.find((v) => v.kind === 'gunship' && v.side === side)!;

type Stamped = SimEvent & { tick: number };
interface Run {
  events: Stamped[];
  views: CommanderView[]; // nato's view after each step; views[i] follows the step of tick i
  pact: CommanderView[];
}

/** Calls the gunship on the first step (unless `call` is false), then steps `ticks` in all; `each` runs before every step. */
function play(m: Match, ticks: number, { at, call = true, run = { events: [], views: [], pact: [] }, each }: { at?: Vec2; call?: boolean; run?: Run; each?: (i: number) => void } = {}): Run {
  for (let i = 0; i < ticks; i++) {
    each?.(i);
    const tick = m.tick;
    run.events.push(...step(m, call && i === 0 ? [gunship(m, at)] : []).map((e) => ({ ...e, tick })));
    run.views.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

/** Calls the gunship and steps until its "on station" radio line (a minute at most), then `extra` ticks more. */
const toStation = (m: Match, extra = 0) => {
  const run = play(m, 1);
  while (said(run, 'Gunship on station') < 0 && run.views.length < 60 * HZ) play(m, 1, { call: false, run });
  expect(said(run, 'Gunship on station')).toBeGreaterThan(0);
  return play(m, extra, { call: false, run });
};

const said = (r: Run, text: string) => r.events.find((e) => e.kind === 'radio' && e.type === 'asset' && e.text === text)?.tick ?? -1;
const impacts = (r: Run) => r.events.filter((e): e is Extract<Stamped, { kind: 'impact' }> => e.kind === 'impact');
const effect = (v: CommanderView) => v.effects!.find((e) => e.asset === 'gunship');
const row = (v: CommanderView) => v.assets!.find((a) => a.asset === 'gunship')!;
const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));

/** Brings Soldier `id` (on foot) back on the next step: dead long enough (its Squad is quiet: nobody sees anyone). */
const comeBack = (m: Match, id: number) => Object.assign(m.soldiers[id]!, { state: 'dead', deadAt: m.tick - DEFAULT_TUNE.respawnSeconds * HZ });

describe('Gunship: the call', () => {
  it('starts on cooldown: first ready at 5:00, its route fixed: a 200 m circle round the middle point', () => {
    const m = scene({}, { gunshipCooldownSeconds: 300 });
    expect(row(commanderView(m, 'nato'))).toMatchObject({ readyIn: 300, cooldown: 300, radius: R, at: { x: 0, y: 0 } });
    expect(rejections(step(m, [gunship(m)]))).toEqual(['cooling down']);
  });

  it('needs the middle Capture Point: without it the row is off and Confirm is refused; the cooldown still runs', () => {
    const m = scene();
    m.points.find((p) => p.id === 'C')!.owner = 'pact';
    expect(row(commanderView(m, 'nato'))).toMatchObject({ off: 'needs C', readyIn: 0 });
    expect(rejections(step(m, [gunship(m)]))).toEqual(['needs C']);
    m.points.find((p) => p.id === 'C')!.owner = 'nato';
    expect(row(commanderView(m, 'nato')).off).toBeUndefined();
    expect(rejections(step(m, [gunship(m)]))).toEqual([]);
  });

  it('#150: on a map that names its keystone, needs every keystone point, and the route circles the middle of them', () => {
    const m = createMatch({ seed: 1, map: { ...field, keystone: ['B', 'C'] }, tune: { ...DEFAULT_TUNE, gunshipCooldownSeconds: 0 }, squadsPerSide: 1, commanderSide: 'nato' });
    expect(row(commanderView(m, 'nato'))).toMatchObject({ off: 'needs B', at: { x: 0, y: 150 } });
    m.points.find((p) => p.id === 'B')!.owner = 'nato';
    expect(row(commanderView(m, 'nato')).off).toBeUndefined();
    const run = toStation(m);
    expect(Math.hypot(body(m).x, body(m).y - 150)).toBeCloseTo(R, 3);
    expect(effect(run.views.at(-1)!)).toMatchObject({ x: 0, y: 150 });
  });

  it('one aircraft a Side: while it is up the row is off and a second call is refused', () => {
    const m = scene();
    step(m, [gunship(m)]);
    expect(row(commanderView(m, 'nato')).off).toBe('up');
    expect(rejections(step(m, [gunship(m)]))).toEqual(['up']);
    expect(row(commanderView(m, 'pact')).off).not.toBe('up'); // pact's own is still asleep
  });
});

describe('Gunship: the sortie', () => {
  it('whatever spot the call names, flies in at 60 m/s, circles its route counter-clockwise for 45 s, then flies home; both Sides see it all the way', () => {
    const m = scene();
    const run = play(m, 120 * HZ, { at: { x: -200, y: 150 } });
    expect(said(run, 'Gunship inbound')).toBe(0);
    const station = said(run, 'Gunship on station');
    const leaving = said(run, 'Gunship leaving');
    expect(effect(run.views[0]!)).toMatchObject({ side: 'nato', phase: 'inbound', from: { x: -1556, y: 0 }, x: 0, y: 0, radius: R });
    expect(station / HZ).toBeCloseTo(Math.sqrt(1556 ** 2 - R ** 2) / 60, 0); // straight to where the line in touches the circle
    expect(leaving - station).toBe(45 * HZ);
    let turn = 0;
    for (let i = station; i < leaving; i++) {
      const c = effect(run.views[i]!)!.craft!;
      expect(Math.hypot(c.x, c.y)).toBeCloseTo(R, 3);
      const prev = effect(run.views[i - 1]!)!.craft!;
      turn += prev.x * c.y - prev.y * c.x; // > 0: counter-clockwise
      expect(c.fx * c.x + c.fy * c.y).toBeCloseTo(0, 6); // along the circle
    }
    expect(turn).toBeGreaterThan(0);
    const home = run.views.findIndex((v, i) => i > leaving && !effect(v));
    expect(home).toBeGreaterThan(leaving + 20 * HZ); // all the way back beyond the map edge
    const last = effect(run.views[home - 1]!)!;
    expect(Math.hypot(last.craft!.x + 1556, last.craft!.y)).toBeLessThan(60 / HZ + 1e-9);
    for (let i = 0; i < home; i++) {
      expect(effect(run.pact[i]!)).toEqual(effect(run.views[i]!)); // the sky rule
      expect(run.pact[i]!.vehicles).toContainEqual(expect.objectContaining({ kind: 'gunship', side: 'nato', airborne: true }));
    }
    expect(run.views.at(-1)!.vehicles!.some((v) => v.kind === 'gunship')).toBe(false); // asleep again
    expect(row(run.views.at(-1)!).off).toBeUndefined();
  });

  it('with no enemy in reach, it fires nothing', () => {
    const run = play(scene(), 120 * HZ);
    expect(said(run, 'Gunship leaving')).toBeGreaterThan(0);
    expect(impacts(run)).toEqual([]);
  });

  it('the first shell lands no earlier than 3 s after the orbit begins, at an enemy in reach, one every 4 s while there is one', () => {
    const targets = [{ x: 0, y: -150 }, { x: -60, y: -100 }, { x: 40, y: -60 }];
    const run = play(scene({ 6: targets[0]!, 7: targets[1]!, 8: targets[2]! }), 80 * HZ);
    const station = said(run, 'Gunship on station');
    const shells = impacts(run);
    expect(shells.length).toBeGreaterThan(0);
    expect(shells[0]!.tick - station).toBe(3 * HZ + 1); // it fires on the orbit's first step round, and the shell flies 3 s
    expect(shells.every((s) => s.asset === 'gunship' && s.side === 'nato')).toBe(true);
    for (let k = 1; k < shells.length; k++) expect(shells[k]!.tick - shells[k - 1]!.tick).toBeGreaterThanOrEqual(4 * HZ);
    expect(said(run, 'Splash')).toBe(shells[0]!.tick);
    for (const s of shells) expect(targets.some((p) => Math.hypot(s.x - p.x, s.y - p.y) <= 8)).toBe(true);
  });

  it('an enemy standing still within 200 m of the aircraft is a Contact from the orbit on (not before, nor out of reach), and a shell hits it within 20 s', () => {
    const m = scene({ 6: { x: 0, y: -150 }, 7: { x: 0, y: 330 } });
    const run = play(m, 60 * HZ);
    const station = said(run, 'Gunship on station');
    const contact = (i: number, id = 6) => run.views[i]!.contacts.some((c) => c.id === id);
    expect(contact(station - 1)).toBe(false);
    const hit = run.events.find((e) => (e.kind === 'wounded' || e.kind === 'death') && e.id === 6)!.tick;
    expect(hit - station).toBeLessThanOrEqual(20 * HZ);
    for (let i = station; i < hit; i++) expect(contact(i)).toBe(true);
    const reach = (i: number) => Math.hypot(effect(run.views[i]!)!.craft!.x, effect(run.views[i]!)!.craft!.y - 330) <= 200;
    const hit7 = run.events.find((e) => (e.kind === 'wounded' || e.kind === 'death') && e.id === 7)?.tick ?? Infinity;
    const passes = run.views.slice(station, Math.min(hit7, run.views.length)).map((_, k) => station + k); // on station all the minute
    expect(passes.some(reach)).toBe(true);
    for (const i of passes) expect(contact(i, 7)).toBe(reach(i)); // 130 m beyond the route: only as it passes
  });

  it('a kill scores the caller in artillery at the shell tariff', () => {
    const run = play(scene({ 6: { x: 0, y: -150 } }, { gunshipScatterM: 0 }), 60 * HZ);
    expect(run.events).toContainEqual(expect.objectContaining({ kind: 'award', side: 'nato', category: 'artillery', points: DEFAULT_TUNE.scoreArtilleryKill, reason: 'Gunship kill' }));
  });

  it('its sortie, its aircraft, its shells and what they did to a Soldier are part of the state hash', () => {
    const m = scene({ 6: { x: 0, y: -150 } }, { gunshipScatterM: 0 });
    const run = play(m, 30 * HZ);
    const e = m.assets.effects[0]!;
    expect(e.shells!.length).toBeGreaterThan(0);
    const moves = (nudge: () => void, undo: () => void, what: string) => {
      const h = stateHash(m);
      nudge();
      expect(stateHash(m), what).not.toBe(h);
      undo();
      expect(stateHash(m), what).toBe(h);
    };
    for (const k of ['phaseAt', 'nextShot', 'vehicle'] as const) moves(() => (e[k]! += 1), () => (e[k]! -= 1), k);
    const v = body(m);
    for (const k of ['x', 'y', 'fx', 'fy', 'hp'] as const) moves(() => (v[k] += 0.01), () => (v[k] -= 0.01), `vehicle.${k}`);
    moves(() => (v.seats[2] = 3), () => (v.seats[2] = -1), 'seat');
    moves(() => (e.phase = 'leaving'), () => (e.phase = 'station'), 'phase');
    moves(() => (e.from!.y += 1), () => (e.from!.y -= 1), 'from');
    moves(() => (e.shells![0]!.from!.x += 1), () => (e.shells![0]!.from!.x -= 1), 'shell from');
    moves(() => (e.shells![0]!.done = !e.shells![0]!.done), () => (e.shells![0]!.done = !e.shells![0]!.done), 'shell done');
    expect(run.events.some((e) => e.kind === 'impact')).toBe(true);
    const s = m.soldiers[7]!;
    s.cause = 'gunship';
    moves(() => (s.cause = 'barrage'), () => (s.cause = 'gunship'), 'cause');
  });

  it('a seeded replay shows the same shells, seats, jumps and casualties on every run', () => {
    const place = { 6: { x: 0, y: -150 }, 7: { x: -60, y: -100 }, 8: { x: 40, y: -60 }, 9: { x: 10, y: -20 } };
    const once = () => {
      const m = scene(place, { crewSpawnChance: 0.5, paradropChance: 0.5 }, 7);
      const sq = m.squads.find((q) => q.side === 'nato')!;
      Object.assign(sq, { task: 'point', goal: 0, nextThink: Infinity }); // B
      const back = (i: number) => {
        const s = m.soldiers.find((o) => o.side === 'nato' && o.id !== sq.members[0] && o.vehicle < 0 && !o.chute && o.state === 'alive' && o.id === 1 + ((i / (3 * HZ)) % 5));
        if (s && i % (3 * HZ) === 0) comeBack(m, s.id);
      };
      const run = play(m, 80 * HZ, { each: back });
      return { hash: stateHash(m), events: run.events.filter((e) => e.kind === 'impact' || e.kind === 'wounded' || e.kind === 'death' || e.kind === 'shot') };
    };
    const [a, b] = [once(), once()];
    expect(a.events.some((e) => e.kind === 'impact')).toBe(true);
    expect(a.events.some((e) => e.kind === 'shot')).toBe(true); // a gunner took the seat
    expect(b).toEqual(a);
  });
});

describe('Gunship: aboard', () => {
  it('a Soldier coming back while it is on station may take its gun seat: never the Squad Leader; it fires its left side gun at enemies below, which both Sides see', () => {
    const m = scene({}, { crewSpawnChance: 1 });
    toStation(m, HZ);
    const v = body(m);
    comeBack(m, 0); // the Squad Leader
    play(m, 1, { call: false });
    expect(v.seats[1]).toBe(-1);
    comeBack(m, 2);
    play(m, 1, { call: false });
    expect(v.seats[1]).toBe(2);
    expect(m.soldiers[2]).toMatchObject({ vehicle: v.id, crew: true });
    const left = { x: v.x - v.fy * 80, y: v.y + v.fx * 80 }; // 80 m off its left, toward the middle
    Object.assign(m.soldiers[6]!, left);
    const run = play(m, HZ, { call: false });
    const shots = run.events.filter((e): e is Extract<Stamped, { kind: 'shot' }> => e.kind === 'shot' && e.from === 2);
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(shots.every((s) => s.to === 6)).toBe(true);
    expect(m.soldiers[2]).toMatchObject({ x: v.x, y: v.y }); // it rides along
    expect(commanderEvents(m, 'pact', shots)).toEqual(shots); // the sky rule: the enemy sees the gun fire
  });

  it('a Soldier coming back takes a passenger seat when the route passes nearer its goal than where it came back, and jumps where it passes nearest', () => {
    const m = scene({ 0: { x: 0, y: 285 } }, { paradropChance: 1 });
    const sq = m.squads.find((q) => q.side === 'nato')!;
    Object.assign(sq, { task: 'point', goal: m.points.findIndex((p) => p.id === 'B'), nextThink: Infinity }); // B, 100 m beyond the route
    toStation(m, HZ);
    const v = body(m);
    comeBack(m, 3);
    play(m, 1, { call: false });
    expect(m.soldiers[3]!.vehicle).toBe(-1); // back beside its leader at B: nearer than the route ever comes
    m.soldiers[0]!.x = -415; // its leader back at the HQ: B is 515 m from where it comes back
    comeBack(m, 3);
    play(m, 1, { call: false });
    expect(m.soldiers[3]!.vehicle).toBe(v.id);
    expect(v.seats.indexOf(3)).toBeGreaterThanOrEqual(2);
    let jumped: Vec2 | null = null;
    play(m, 30 * HZ, { call: false, each: () => void (!jumped && m.soldiers[3]!.chute && (jumped = { x: m.soldiers[3]!.chute.x0, y: m.soldiers[3]!.chute.y0 })) });
    expect(jumped).not.toBeNull();
    expect(Math.hypot(jumped!.x - 0, jumped!.y - R)).toBeLessThan(10); // where the circle comes nearest B
    expect(m.soldiers[3]).toMatchObject({ vehicle: -1, chute: null, state: 'alive' }); // down, on foot
    expect(Math.hypot(m.soldiers[3]!.x - jumped!.x, m.soldiers[3]!.y - jumped!.y)).toBeLessThanOrEqual(DEFAULT_TUNE.chuteScatterM + 1e-9);
  });

  it('everyone still aboard bails out as it turns for home', () => {
    const m = scene({}, { crewSpawnChance: 1, paradropChance: 1 });
    const sq = m.squads.find((q) => q.side === 'nato')!;
    Object.assign(sq, { task: 'point', goal: m.points.findIndex((p) => p.id === 'B'), nextThink: Infinity });
    const run = toStation(m, HZ);
    const v = body(m);
    comeBack(m, 1); // the gunner
    play(m, 1, { call: false, run });
    play(m, 33 * HZ, { call: false, run }); // its second pass by B is behind it, and it leaves before the third
    comeBack(m, 3); // a passenger for B
    play(m, 1, { call: false, run });
    expect(v.seats[1]).toBe(1);
    expect(v.seats.indexOf(3)).toBeGreaterThanOrEqual(2);
    while (said(run, 'Gunship leaving') < 0) play(m, 1, { call: false, run });
    expect(v.seats.every((id) => id < 0)).toBe(true);
    for (const id of [1, 3]) expect(m.soldiers[id]!.chute).toMatchObject({ t0: said(run, 'Gunship leaving') });
  });
});

describe('Gunship: the enemy AA', () => {
  /** pact's AA crewed by pact's 11 at `at`. */
  const withAa = (at: Vec2, place: Record<number, Vec2> = {}, tune: Partial<Tune> = {}) => {
    const m = scene(place, tune, 1, 1);
    const aa = m.vehicles.find((v) => v.kind === 'aa' && v.side === 'pact')!;
    Object.assign(aa, { ...at, seats: [11] });
    Object.assign(m.soldiers[11]!, { ...at, vehicle: aa.id });
    return { m, aa };
  };

  it('fires on it as on a helicopter: under a third it leaves early (everyone aboard jumps), at 0 it falls as a Wreck both Sides see and fires no more; the cooldown stands', () => {
    const { m, aa } = withAa({ x: 0, y: 0 }, { 6: { x: 0, y: -150 }, 7: { x: -60, y: -100 } }, { gunshipCooldownSeconds: 300, crewSpawnChance: 1 });
    m.assets.readyAt.nato.gunship = 0;
    const run = toStation(m, HZ);
    const v = body(m);
    comeBack(m, 1);
    play(m, 1, { call: false, run });
    expect(v.seats[1]).toBe(1);
    let bailed = -1;
    play(m, 90 * HZ - run.views.length, { call: false, run, each: () => void (bailed < 0 && m.soldiers[1]!.chute && (bailed = m.soldiers[1]!.chute.t0)) });
    const fire = run.events.filter((e) => e.kind === 'shot' && e.side === 'pact' && e.to === v.id);
    const leaving = said(run, 'Gunship leaving');
    const down = run.views.findIndex((u) => u.vehicles!.some((w) => w.kind === 'gunship' && w.wreck));
    expect(fire.length).toBeGreaterThan(0);
    expect(fire.every((e) => e.kind === 'shot' && e.from === 11)).toBe(true);
    expect(aa.id).not.toBe(v.id);
    expect(leaving).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(leaving);
    expect(bailed).toBe(leaving); // its gunner jumped as it broke off
    expect(m.wrecks).toContainEqual(expect.objectContaining({ side: 'nato', kind: 'gunship', seen: true }));
    expect(commanderView(m, 'pact').vehicles).toContainEqual(expect.objectContaining({ kind: 'gunship', wreck: true }));
    const launched = run.views.flatMap((u, i) => (effect(u)?.shells ?? []).filter((s) => s.flight === 0).map(() => i));
    expect(launched.every((i) => i < leaving)).toBe(true);
    expect(effect(run.views[down]!)?.craft).toBeUndefined(); // gone, or only its last shells still in the air
    expect(impacts(run).every((s) => s.tick <= down + 3 * HZ)).toBe(true);
    expect(row(run.views.at(-1)!).readyIn).toBe(300 - 90); // from the call, as if it had never been hit
  });

  it('lays its gun on the Gunship before a jeep, as on a helicopter; never while the Gunship is off the Play Area', () => {
    const { m, aa } = withAa({ x: 0, y: 0 }, {}, { jeepsPerSide: 1 });
    toStation(m, HZ);
    const v: Vehicle = body(m);
    const jeep = m.vehicles.find((u) => u.kind === 'jeep' && u.side === 'nato')!;
    Object.assign(jeep, { x: 40, y: 0 });
    look(m, aa);
    expect(aa.target).toBe(v.id);
    Object.assign(v, { x: -500, y: 0 });
    Object.assign(aa, { x: -300, y: 0 });
    look(m, aa);
    expect(aa.target).not.toBe(v.id);
  });
});
