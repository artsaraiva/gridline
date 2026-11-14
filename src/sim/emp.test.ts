// EMP Strike (#143), through the Simulation interface: the call, the missile's flight from the HQ, the airburst, and the
// vehicles it holds for `empSeconds`: they neither move nor fire, the jet flies on, and Soldiers are untouched.
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune, Vec2 } from './types';
import type { VehicleOf } from './vehicles';

const HZ = DEFAULT_TUNE.hz;

/** Kaltenbach's shape in the open: HQs 415 m out on the flanks, the Play Area edge 456 m out. */
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -456, y: -456 },
    { x: 456, y: -456 },
    { x: 456, y: 456 },
    { x: -456, y: 456 },
  ],
  hqs: { nato: { x: -415, y: 0 }, pact: { x: 415, y: 0 } },
  points: [{ id: 'C', name: 'C', x: 0, y: 0 }],
  grid: { cols: 12, rows: 12, squareM: 76, letters: 'ABCDEFGHIJKL' },
};

/** nato Soldiers 0..5, pact 6..11, stood where placed (else at their HQ); nobody fires or walks. The EMP is ready at once. */
function scene(place: Record<number, Vec2 & { fx?: number }> = {}, tune: Partial<Tune> = {}, seed = 1): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, walkSpeed: 0, empCooldownSeconds: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, crewSpawnChance: 0, ...tune };
  const m = createMatch({ seed, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const emp = (m: Match, at: Vec2): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'emp', at });

type Stamped = SimEvent & { tick: number };
interface Run {
  events: Stamped[];
  views: CommanderView[]; // nato's view after each step
  pact: CommanderView[];
}

/** Calls the EMP at `at` on the first step, then steps `ticks` in all. */
function play(m: Match, ticks: number, at: Vec2): Run {
  const run: Run = { events: [], views: [], pact: [] };
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    run.events.push(...step(m, i === 0 ? [emp(m, at)] : []).map((e) => ({ ...e, tick })));
    run.views.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

const said = (r: Run, text: string) => r.events.find((e) => e.kind === 'radio' && e.type === 'asset' && e.text === text)?.tick ?? -1;
const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));
const row = (v: CommanderView) => v.assets!.find((a) => a.asset === 'emp')!;
const CENTRE = { x: 0, y: 0 };

describe('EMP Strike: the call', () => {
  it('starts on its 180 s cooldown with a 60 m ring and no point gate, and says "EMP away"', () => {
    const m = scene({}, { empCooldownSeconds: 180 });
    expect(row(commanderView(m, 'nato'))).toMatchObject({ readyIn: 180, cooldown: 180, radius: 60 });
    expect(row(commanderView(m, 'nato')).off).toBeUndefined(); // nobody holds C
    for (let i = 0; i < 180 * HZ - 1; i++) step(m, []);
    expect(rejections(step(m, [emp(m, CENTRE)]))).toEqual(['cooling down']);
    const run = play(m, 1, CENTRE);
    expect(said(run, 'EMP away')).toBe(180 * HZ);
    expect(row(run.views[0]!).readyIn).toBeCloseTo(180 - 1 / HZ); // the cooldown runs from the call
  });
});

const effect = (v: CommanderView) => v.effects!.find((e) => e.asset === 'emp');
/** 415 m from the HQ to the centre at 60 m/s. */
const FLIGHT = Math.round((415 / 60) * HZ);

describe('EMP Strike: the flight', () => {
  it('leaves the own HQ and flies level and straight at the spot at 60 m/s, in both Sides\' views', () => {
    const run = play(scene(), FLIGHT, CENTRE);
    expect(effect(run.views[0]!)).toMatchObject({ side: 'nato', from: { x: -415, y: 0 }, x: 0, y: 0, radius: 60 });
    const at5 = effect(run.pact[5 * HZ - 1]!)!; // the sky rule
    expect(at5.flight).toBeCloseTo(300 / 415, 2);
    expect(at5.impactIn).toBeCloseTo(415 / 60 - 5, 1);
    expect(at5.burst).toBeUndefined();
  });

  it('bursts over the spot 6.9 s after confirm: no crater, no blast, and the ring stays 12 s', () => {
    const m = scene({ 6: { x: 0, y: 0 } });
    const run = play(m, FLIGHT + 12 * HZ + 1, CENTRE);
    expect(run.events.filter((e) => e.kind === 'impact')).toEqual([]);
    expect(effect(run.views[FLIGHT - 2]!)!.burst).toBeUndefined();
    expect(effect(run.views[FLIGHT]!)).toMatchObject({ flight: 1, impactIn: 0, burst: 1 / HZ });
    expect(effect(run.views[FLIGHT + 12 * HZ - 2]!)).toBeTruthy();
    expect(effect(run.views[FLIGHT + 12 * HZ]!)).toBeUndefined();
    expect(m.soldiers[6]).toMatchObject({ state: 'alive', hp: DEFAULT_TUNE.hp, suppression: 0 }); // Soldiers are unaffected
  });
});

describe('EMP Strike: a tank in the ring', () => {
  // pact's tank, crewed by its 6 (driving) and 7 (on the coax), sets off east from (-200, 50) for A; the EMP is called on
  // its start, 240 m from nato's HQ: 4 s of flight. nato's 2..5 stand north-east of its road, in its sights.
  const SPOT = { x: -180, y: 50 };
  const BURST = Math.round((Math.hypot(415 - 180, 50) / 60) * HZ);
  function tankScene(tune: Partial<Tune> = {}) {
    const m = scene({ 2: { x: -100, y: 120 }, 3: { x: -80, y: 130 }, 4: { x: -60, y: 120 }, 5: { x: -40, y: 130 } }, { tanksPerSide: 1, rockets: 0, hp: 1e9, ...tune });
    m.map.points.push({ id: 'A', name: 'A', x: 200, y: 50, owner: 'nato' });
    m.points.push({ id: 'A', name: 'A', x: 200, y: 50, radius: DEFAULT_TUNE.captureRadius, owner: 'nato', progress: 0 });
    Object.assign(m.vehicles.find((v) => v.kind === 'tank' && v.side === 'nato')!, { hp: 0, deadAt: 0 }); // nato's own is out of it: back in 60 s, after the test (a held tank is a sitting duck)
    const tank = m.vehicles.find((v) => v.kind === 'tank' && v.side === 'pact')!;
    Object.assign(tank, { x: -200, y: 50, fx: 1, fy: 0, seats: [6, 7], goal: 1 });
    for (const id of [6, 7]) Object.assign(m.soldiers[id]!, { x: -200, y: 50, vehicle: tank.id });
    return { m, tank };
  }

  it('stops dead and fires nothing for 12 s, then drives and fires again', () => {
    const { m, tank } = tankScene();
    const track: { x: number; speed: number }[] = [];
    const run: Run = { events: [], views: [], pact: [] };
    for (let i = 0; i < BURST + 20 * HZ; i++) {
      const tick = m.tick;
      run.events.push(...step(m, i === 0 ? [emp(m, SPOT)] : []).map((e) => ({ ...e, tick })));
      track.push({ x: tank.x, speed: tank.speed });
    }
    expect(said(run, 'EMP away')).toBe(0);
    expect(track[BURST - 1]!.speed).toBeGreaterThan(0); // on its way when the burst comes
    const held = track.slice(BURST, BURST + 12 * HZ);
    expect(held.every((p) => p.speed === 0 && p.x === held[0]!.x)).toBe(true);
    expect(track.at(-1)!.x).toBeGreaterThan(held[0]!.x + 10); // and on its way again after
    const fire = (a: number, b: number) => run.events.filter((e) => e.tick >= a && e.tick < b && ((e.kind === 'impact' && e.from === tank.id) || (e.kind === 'shot' && e.from === 7)));
    expect(fire(0, BURST).length).toBeGreaterThan(0);
    expect(fire(BURST, BURST + 12 * HZ)).toEqual([]);
    expect(fire(BURST + 12 * HZ, BURST + 20 * HZ).length).toBeGreaterThan(0);
  });

  it('a Launcher behind it gets its three rockets off meanwhile, and nothing comes back', () => {
    const { m, tank } = tankScene({ rockets: 3 });
    Object.assign(m.soldiers[1]!, { x: -240, y: 50, rockets: 0 }); // nato's Launcher, out of the tank's sight behind it, comes up empty
    play(m, BURST, SPOT);
    m.soldiers[1]!.rockets = 3; // ... and is handed its rockets as the burst comes
    const events: SimEvent[] = [];
    for (let i = 0; i < 12 * HZ; i++) events.push(...step(m, []));
    expect(events.filter((e) => e.kind === 'shot' && e.from === 1 && e.to === tank.id)).toHaveLength(3);
    expect(tank.deadAt).toBeGreaterThanOrEqual(0); // three rockets kill a tank
    expect(events.filter((e) => (e.kind === 'impact' && e.from === tank.id) || (e.kind === 'shot' && e.from === 7))).toEqual([]);
  });
});

describe('EMP Strike: the air', () => {
  /** Steps to the tick before the burst over the centre, then puts `place` there, then plays the burst and `seconds` more. */
  function burstWith(m: Match, place: () => void, seconds: number) {
    play(m, FLIGHT, CENTRE);
    place();
    const events: Stamped[] = [];
    for (let i = 0; i <= seconds * HZ; i++) {
      const tick = m.tick;
      events.push(...step(m, []).map((e) => ({ ...e, tick })));
    }
    return events;
  }

  it('an AA in the ring lets a jet pass unharmed for 12 s, then fires on it again; the jet itself is immune', () => {
    const m = scene({}, { aasPerSide: 1, jetsPerSide: 1 });
    const aa = m.vehicles.find((v) => v.kind === 'aa' && v.side === 'pact')!;
    const jet = m.vehicles.find((v) => v.kind === 'jet' && v.side === 'nato')!;
    Object.assign(aa, { x: 20, y: 0, seats: [11] });
    Object.assign(m.soldiers[11]!, { x: 20, y: 0, vehicle: aa.id });
    const burst = m.tick + FLIGHT;
    const events = burstWith(m, () => Object.assign(jet, { x: 0, y: 30, fx: 1, fy: 0, airborne: true, seats: [-1] }), 18); // over the AA as the burst comes, and hanging there: nobody flies it
    expect(jet.disabledUntil).toBe(0);
    const fire = (a: number, b: number) => events.filter((e) => e.tick >= a && e.tick < b && e.kind === 'shot' && e.from === 11).length;
    expect(fire(burst, burst + 12 * HZ)).toBe(0);
    expect(aa.missiles.filter((s) => s.launch >= burst && s.launch < burst + 12 * HZ)).toEqual([]);
    expect(jet.hp).toBeLessThan(DEFAULT_TUNE.jetHp); // hit, but only once the AA is back
    expect(fire(burst + 12 * HZ, burst + 18 * HZ)).toBeGreaterThan(0);
  });

  it('a helicopter in the ring hangs where it is in the air, then flies on with the job it had', () => {
    const m = scene({}, { helisPerSide: 1 });
    const heli = m.vehicles.find((v) => v.kind === 'helicopter' && v.side === 'pact') as VehicleOf<'helicopter'>;
    const track: { x: number; speed: number; airborne: boolean; job: string }[] = [];
    play(m, FLIGHT, CENTRE);
    Object.assign(heli, { x: 0, y: 20, fx: 1, fy: 0, speed: DEFAULT_TUNE.heliMps, airborne: true, seats: [8, -1, -1, -1, -1, -1] }); // flying east with its pilot as the burst comes, to the Squad that claimed it at its HQ
    Object.assign(m.soldiers[8]!, { x: 0, y: 20, vehicle: heli.id });
    for (let i = 0; i < 16 * HZ; i++) {
      step(m, []);
      track.push({ x: heli.x, speed: heli.speed, airborne: heli.airborne, job: heli.heli.job });
    }
    const job = track[0]!.job; // its pilot's think on the burst tick, before the burst, gave it the job
    expect(job).toBe('ferry');
    const held = track.slice(0, 12 * HZ - 1);
    expect(held.every((p) => p.x === 0 && p.speed === 0 && p.airborne && p.job === job)).toBe(true);
    expect(track.at(-1)!.x).toBeGreaterThan(10); // on its way again
    expect(track.at(-1)!.job).toBe(job);
  });
});

describe('EMP Strike: what it tells and shows', () => {
  /** pact's tank, empty, 30 m east of the spot (far out of nato's sight), and nato's jeep 10 m west of it with nato's 0 driving and 2 riding: both in the ring. */
  function ring(tune: Partial<Tune> = {}) {
    const m = scene({}, { tanksPerSide: 1, jeepsPerSide: 1, ...tune });
    const tank = m.vehicles.find((v) => v.kind === 'tank' && v.side === 'pact')!;
    const jeep = m.vehicles.find((v) => v.kind === 'jeep' && v.side === 'nato')!;
    Object.assign(tank, { x: 30, y: 0 });
    Object.assign(jeep, { x: -10, y: 0, seats: [0, 2, -1, -1] });
    for (const id of [0, 2]) Object.assign(m.soldiers[id]!, { x: -10, y: 0, vehicle: jeep.id });
    return { m, tank, jeep };
  }

  it('holds the caller\'s own vehicles in the ring too, and their riders may still get out', () => {
    // nato's jeep, 0 driving and 2 riding, on its way to C 200 m off as the burst comes down on it
    const m = scene({}, { jeepsPerSide: 1 });
    const jeep = m.vehicles.find((v) => v.kind === 'jeep' && v.side === 'nato')!;
    const spot = { x: -150, y: 150 };
    play(m, Math.round((Math.hypot(415 - 150, 150) / 60) * HZ), spot);
    Object.assign(jeep, { x: -160, y: 150, fx: 1, fy: 0, speed: 9, goal: 0, movedAt: m.tick, seats: [0, 2, -1, -1] });
    for (const id of [0, 2]) Object.assign(m.soldiers[id]!, { x: -160, y: 150, vehicle: jeep.id });
    const views: CommanderView[] = [];
    for (let i = 0; i <= 12 * HZ; i++) {
      step(m, []);
      views.push(commanderView(m, 'nato'));
    }
    expect(views[0]!.vehicles!.find((v) => v.id === jeep.id)).toMatchObject({ disabled: true });
    expect(views[12 * HZ]!.vehicles!.find((v) => v.id === jeep.id)!.disabled).toBeUndefined();
    const out = views.findIndex((v) => v.friendlies.find((f) => f.id === 2)!.vehicle === undefined);
    expect(out / HZ).toBeGreaterThanOrEqual(DEFAULT_TUNE.stillSeconds); // it stood still long enough for its rider to get out ...
    expect(out).toBeLessThan(12 * HZ); // ... while the EMP held it
  });

  it('shows the enemy vehicles it holds as Contacts for 2 s, and says how many: never the caller\'s own', () => {
    const { m, tank } = ring();
    const run = play(m, FLIGHT + 3 * HZ, CENTRE);
    const seen = (v: CommanderView) => v.vehicles!.find((u) => u.id === tank.id);
    expect(seen(run.views[FLIGHT - 2]!)).toBeUndefined();
    expect(seen(run.views[FLIGHT]!)).toMatchObject({ side: 'pact', kind: 'tank', disabled: true });
    expect(seen(run.views[FLIGHT + 2 * HZ - 2]!)).toBeTruthy();
    expect(seen(run.views[FLIGHT + 2 * HZ + 1]!)).toBeUndefined();
    expect(run.views[FLIGHT + 2 * HZ + 1]!.lastKnown!.length).toBeGreaterThan(0); // a Last Known Position after
    expect(said(run, 'EMP effective, 1 vehicle')).toBe(FLIGHT);
    expect(said(play(scene(), FLIGHT + 1, CENTRE), 'EMP effective, no vehicles')).toBe(FLIGHT);
  });

  it('leaves alone a vehicle in its own HQ: nothing reaches into an HQ', () => {
    const away = Object.fromEntries([6, 7, 8, 9, 10, 11].map((id) => [id, { x: 200, y: 300 + id }])); // pact's Soldiers out of the HQ, so nobody drives it out
    const m = scene(away, { tanksPerSide: 1 });
    const tank = m.vehicles.find((v) => v.kind === 'tank' && v.side === 'pact')!;
    Object.assign(tank, { x: 395, y: 0 }); // 20 m inside its 35 m HQ, 50 m from the spot just outside it
    const run = play(m, Math.round((Math.hypot(415 + 345, 0) / 60) * HZ) + 1, { x: 345, y: 0 });
    expect(tank.disabledUntil).toBe(0);
    expect(run.events.some((e) => e.kind === 'radio' && e.text === 'EMP effective, no vehicles')).toBe(true);
  });

  it('is hashed: the same call replays the same, and a held vehicle moves the hash', () => {
    const [a, b] = [ring().m, ring().m];
    play(a, FLIGHT + 1, CENTRE);
    play(b, FLIGHT + 1, CENTRE);
    expect(stateHash(a)).toBe(stateHash(b));
    b.vehicles.find((v) => v.kind === 'jeep' && v.side === 'nato')!.disabledUntil++;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});
