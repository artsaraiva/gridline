// Drone Strike (#139), through the Simulation interface: the call, the flight from the HQ, the blast, and the enemy AA shooting it down.
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SimEvent, Tune, Vec2 } from './types';

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

/** nato Soldiers 0..5, pact 6..11, stood where placed (else at their HQ); nobody fires or walks. The drone is ready at once. */
function scene(place: Record<number, Vec2 & { fx?: number }> = {}, tune: Partial<Tune> = {}, seed = 1): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, walkSpeed: 0, droneCooldownSeconds: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, crewSpawnChance: 0, ...tune };
  const m = createMatch({ seed, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const drone = (m: Match, at: Vec2): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'drone', at });

type Stamped = SimEvent & { tick: number };
interface Run {
  events: Stamped[];
  views: CommanderView[]; // nato's view after each step
  pact: CommanderView[];
}

/** Calls the drone at `at` on the first step, then steps `ticks` in all. */
function play(m: Match, ticks: number, at: Vec2): Run {
  const run: Run = { events: [], views: [], pact: [] };
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    run.events.push(...step(m, i === 0 ? [drone(m, at)] : []).map((e) => ({ ...e, tick })));
    run.views.push(commanderView(m, 'nato'));
    run.pact.push(commanderView(m, 'pact'));
  }
  return run;
}

const impacts = (r: Run) => r.events.filter((e): e is Extract<Stamped, { kind: 'impact' }> => e.kind === 'impact');
const said = (r: Run, text: string) => r.events.find((e) => e.kind === 'radio' && e.type === 'asset' && e.text === text)?.tick ?? -1;
const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));
const row = (v: CommanderView) => v.assets!.find((a) => a.asset === 'drone')!;
const effect = (v: CommanderView) => v.effects!.find((e) => e.asset === 'drone');
const CENTRE = { x: 0, y: 0 };
/** 415 m from the HQ to the centre at 30 m/s. */
const FLIGHT = Math.round((415 / 30) * HZ);

describe('Drone Strike: the call', () => {
  it('starts on its 60 s cooldown with a 15 m ring and no point gate', () => {
    const m = scene({}, { droneCooldownSeconds: 60 });
    expect(row(commanderView(m, 'nato'))).toMatchObject({ readyIn: 60, cooldown: 60, radius: 15 });
    expect(row(commanderView(m, 'nato')).off).toBeUndefined(); // nobody holds C
    for (let i = 0; i < 60 * HZ - 1; i++) step(m, []);
    expect(rejections(step(m, [drone(m, CENTRE)]))).toEqual(['cooling down']);
    expect(rejections(step(m, [drone(m, CENTRE)]))).toEqual([]);
  });

  it('says "Drone away", and a second one waits for the first', () => {
    const m = scene();
    const run = play(m, 1, CENTRE);
    expect(said(run, 'Drone away')).toBe(0);
    expect(row(run.views[0]!).off).toBe('in the air');
    expect(rejections(step(m, [drone(m, { x: 50, y: 0 })]))).toEqual(['in the air']);
  });
});

describe('Drone Strike: the flight', () => {
  it('leaves the own HQ and flies straight at the spot at 30 m/s, in both Sides\' views', () => {
    const run = play(scene(), FLIGHT + 3 * HZ, CENTRE);
    expect(effect(run.views[0]!)).toMatchObject({ side: 'nato', from: { x: -415, y: 0 }, craft: { fx: 1, fy: 0, turn: 0 } });
    const at5 = effect(run.pact[5 * HZ]!)!;
    expect(at5.craft!.x).toBeCloseTo(-415 + 150, 0);
    expect(at5.craft!.y).toBe(0);
    expect(at5.flight).toBeCloseTo(150 / 415, 2);
    expect(at5.impactIn).toBeCloseTo(415 / 30 - 5, 0);
    expect(run.pact[5 * HZ]!.vehicles!.some((v) => v.kind === 'drone' && v.side === 'nato')).toBe(true); // the sky rule: the AA's tracers have something to end on
  });

  it('lands one blast 415 m away 13.8 s after confirm, says "Splash", and goes 2 s later', () => {
    const run = play(scene(), FLIGHT + 3 * HZ, CENTRE);
    expect(impacts(run)).toMatchObject([{ tick: FLIGHT, side: 'nato', x: 0, y: 0, asset: 'drone' }]);
    expect(said(run, 'Splash')).toBe(FLIGHT);
    expect(effect(run.views[FLIGHT]!)!.craft).toBeUndefined();
    expect(effect(run.views[FLIGHT + 2 * HZ - 2]!)).toBeTruthy();
    expect(effect(run.views[FLIGHT + 2 * HZ]!)).toBeUndefined();
    expect(row(run.views[FLIGHT + 2 * HZ]!).off).toBeUndefined();
  });
});

describe('Drone Strike: the blast', () => {
  it('kills at the spot, Wounds 6 m away, suppresses 12 m away and leaves 20 m away alone', () => {
    const m = scene({ 6: { x: 0, y: 0 }, 7: { x: 6, y: 0 }, 8: { x: 0, y: 12 }, 9: { x: 20, y: 0 } });
    const run = play(m, FLIGHT + 1, CENTRE);
    expect([6, 7, 8, 9].map((id) => m.soldiers[id]!.state)).toEqual(['dead', 'wounded', 'alive', 'alive']);
    expect(m.soldiers[8]!.suppression).toBeGreaterThan(0.95); // full, less a tick's decay
    expect(m.soldiers[9]!.suppression).toBe(0);
    expect(run.views[FLIGHT]!.contacts.map((c) => c.id)).toEqual([8]); // the living enemy in the 15 m ring
    for (let i = 0; i < 2 * HZ; i++) step(m, []);
    expect(commanderView(m, 'nato').contacts).toEqual([]);
    expect(run.views[FLIGHT]!.score).toMatchObject({ artillery: 100 }); // the shell tariff, for the enemy it killed
  });

  it('spares no friend: a Soldier of the caller at the spot dies, and scores nothing', () => {
    const m = scene({ 0: { x: 2, y: 0 } });
    const run = play(m, FLIGHT + 1, CENTRE);
    expect(m.soldiers[0]!.state).toBe('dead');
    expect(run.pact[FLIGHT]!.score).toMatchObject({ artillery: 0 });
  });

  it('destroys a jeep at the spot and takes half a tank\'s hit points', () => {
    const m = scene({}, { jeepsPerSide: 1, tanksPerSide: 1 });
    const [jeep, tank] = (['jeep', 'tank'] as const).map((k) => m.vehicles.find((v) => v.kind === k && v.side === 'pact')!);
    Object.assign(jeep!, { x: 2, y: 0 });
    Object.assign(tank!, { x: -2, y: 0 });
    play(m, FLIGHT + 1, CENTRE);
    expect(jeep!.deadAt).toBe(FLIGHT);
    expect(tank!.hp).toBe(DEFAULT_TUNE.tankHp / 2);
  });

  it('is hashed: the same call replays the same, and its state moves the hash', () => {
    const [a, b] = [scene(), scene()];
    play(a, 2 * HZ, CENTRE);
    play(b, 2 * HZ, CENTRE);
    expect(stateHash(a)).toBe(stateHash(b));
    b.assets.effects[0]!.land!++;
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});

describe('Drone Strike: the enemy AA', () => {
  /** pact's AA crewed by pact's 11 at `at`. */
  function withAa(at: Vec2, seed = 1) {
    const m = scene({}, { aasPerSide: 1 }, seed);
    const aa = m.vehicles.find((v) => v.kind === 'aa' && v.side === 'pact')!;
    Object.assign(aa, { ...at, seats: [11] });
    Object.assign(m.soldiers[11]!, { ...at, vehicle: aa.id });
    return m;
  }

  it('shoots it down within 3 s of its coming into range: it falls with no blast, "Drone lost", and the cooldown keeps running', () => {
    const after: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const m = withAa({ x: 100, y: 0 }, seed); // in range (300 m) once the drone is 215 m out: 7.2 s
      m.tune.droneCooldownSeconds = 60;
      m.assets.readyAt.nato.drone = 0;
      Object.assign(m.soldiers[6]!, { x: 0, y: 0 });
      const run = play(m, FLIGHT + 3 * HZ, CENTRE);
      const lost = said(run, 'Drone lost');
      expect(lost).toBeGreaterThan(0);
      after.push(lost / HZ - 215 / 30);
      expect(impacts(run)).toEqual([]);
      expect(m.soldiers[6]!.state).toBe('alive');
      expect(effect(run.views[lost]!)).toMatchObject({ lost: true });
      expect(effect(run.views[lost]!)!.craft!.x).toBeLessThan(0);
      expect(effect(run.views[lost + 2 * HZ]!)).toBeUndefined();
      expect(row(run.views[lost + 2 * HZ]!).readyIn).toBeCloseTo(60 - lost / HZ - 2, 0);
      expect(m.wrecks).toEqual([]);
    }
    expect(after.filter((s) => s < 3).length).toBeGreaterThanOrEqual(8); // the missile's seeded miss leaves the odd one to the gun
    expect(Math.max(...after)).toBeLessThan(6);
    expect(after.reduce((a, b) => a + b) / after.length).toBeGreaterThan(1); // no instant kill either
  });

  it('is its last choice in the air: a helicopter in range comes first', () => {
    const m = scene({}, { aasPerSide: 1, helisPerSide: 1 });
    const aa = m.vehicles.find((v) => v.kind === 'aa' && v.side === 'pact')!;
    Object.assign(aa, { x: 100, y: 0, seats: [11] });
    Object.assign(m.soldiers[11]!, { x: 100, y: 0, vehicle: aa.id });
    const heli = m.vehicles.find((v) => v.kind === 'helicopter' && v.side === 'nato')!;
    Object.assign(heli, { x: 100, y: 250, airborne: true, seats: [0, -1, -1, -1, -1, -1] });
    Object.assign(m.soldiers[0]!, { x: 100, y: 250, vehicle: heli.id });
    play(m, 10 * HZ, CENTRE); // the drone is 115 m out, far nearer than the helicopter
    expect(aa.target).toBe(heli.id);
  });
});
