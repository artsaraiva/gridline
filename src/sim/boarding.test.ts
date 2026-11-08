import { describe, expect, it } from 'vitest';
import { RIVER_FIELD } from '../maps/river-field';
import { createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import type { MapData, Tune } from './types';

// #122: a Squad decides to ride, claims one vehicle that fits, walks to it and climbs in one by one; tanks stay crewed by pairs.
const HZ = DEFAULT_TUNE.hz;
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [{ id: 'A', name: 'A', x: -200, y: 0 }],
};
const FAR = { x: 560, y: 500 };

/**
 * Nato's Squads are Soldiers 0..3, 4..7; pact's follow; vehicle ids come after every Soldier. Pact's Soldiers are parked out of
 * sight. The nato Soldiers stand at `at` (default: 20 m up the field from the HQ and their vehicle).
 */
function scene(tune: Partial<Tune>, o: { squads?: number; goal?: number } = {}): Match {
  const squads = o.squads ?? 1;
  const map = { ...field, points: [{ ...field.points[0]!, x: o.goal ?? -200 }] };
  const full: Tune = { ...DEFAULT_TUNE, squadSize: 4, speedJitter: 0, spread: 0, strayChance: 0, visionM: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, pointJeeps: false, rideM: [100, 100], ...NO_TRAITS, ...NO_TEMPO, ...tune };
  const m = thinkOnId(createMatch({ seed: 1, map, tune: full, squadsPerSide: squads, commanderSide: 'nato' }));
  m.soldiers.forEach((s, i) => Object.assign(s, s.side === 'nato' ? { x: -540, y: 4 * (i % 4) - 6 } : FAR));
  m.soldiers.filter((s) => s.side === 'pact').forEach((s) => (s.speed = 0));
  return m;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('#122 boarding: a Squad with a far goal walks to its jeep and climbs in one by one', () => {
  it('each climbs in 1-2 s after reaching it, and nobody jumps more than a step into a seat', () => {
    const m = scene({ jeepsPerSide: 1 });
    const jeep = m.vehicles.find((v) => v.side === 'nato')!;
    const last = m.soldiers.slice(0, 4).map((s) => ({ x: s.x, y: s.y }));
    const reached: number[] = [-1, -1, -1, -1];
    const aboard: number[] = [-1, -1, -1, -1];
    let jump = 0;
    for (let t = 0; t < 12 * HZ; t++) {
      step(m, []);
      m.soldiers.slice(0, 4).forEach((s, i) => {
        if (s.vehicle < 0) jump = Math.max(jump, dist(s, last[i]!));
        if (s.vehicle < 0 && reached[i]! < 0 && dist(s, jeep) <= m.tune.mountM) reached[i] = m.tick;
        if (s.vehicle >= 0 && aboard[i]! < 0) aboard[i] = m.tick;
        last[i] = { x: s.x, y: s.y };
      });
    }
    expect(aboard.every((t) => t > 0)).toBe(true);
    expect(jump).toBeLessThan(0.5); // a walking step is ~0.25 m
    reached.forEach((r, i) => {
      expect(r).toBeGreaterThan(0);
      expect(aboard[i]! - r).toBeGreaterThanOrEqual(HZ - 1);
      expect(aboard[i]! - r).toBeLessThanOrEqual(2 * HZ + 1);
    });
    expect(new Set(aboard).size).toBeGreaterThan(1); // one by one
    expect(jeep.seats.every((id) => id >= 0 && id < 4)).toBe(true);
  });

  it('a Squad whose goal is nearer than its rideM walks', () => {
    const m = scene({ jeepsPerSide: 1, rideM: [500, 500] });
    for (let t = 0; t < 8 * HZ; t++) step(m, []);
    expect(m.soldiers.slice(0, 4).every((s) => s.vehicle < 0)).toBe(true);
    expect(m.vehicles.find((v) => v.side === 'nato')!.seats).toEqual([-1, -1, -1, -1]);
  });

  it('the driver leaves with whoever is in once boardWaitSeconds are up; a rider still walking goes on foot', () => {
    const m = scene({ jeepsPerSide: 1, boardWaitSeconds: 3 });
    for (const i of [0, 2, 3]) Object.assign(m.soldiers[i]!, { x: -558, y: 0 }); // there in no time
    Object.assign(m.soldiers[1]!, { x: -520, y: 0 }); // 40 m off: not there in 3 s
    for (let t = 0; t < 8 * HZ; t++) step(m, []);
    const jeep = m.vehicles.find((v) => v.side === 'nato')!;
    expect(jeep.seats.filter((id) => id >= 0)).toHaveLength(3);
    expect(m.soldiers[1]!.vehicle).toBe(-1);
    expect(jeep.x).toBeGreaterThan(-535);
  });
});

describe('#122 which vehicle fits', () => {
  it('a helicopter takes a goal beyond heliFitM, never one short of it on the same bank', () => {
    const far = scene({ helisPerSide: 1 }, { goal: -50 }); // 490 m from the Squad, past heliFitM
    for (let t = 0; t < 8 * HZ; t++) step(far, []);
    expect(far.soldiers.slice(0, 4).filter((s) => s.vehicle >= 0).length).toBeGreaterThan(0);
    const near = scene({ helisPerSide: 1, rideM: [100, 100] }, { goal: -300 }); // 240 m from the Squad, short of heliFitM
    for (let t = 0; t < 8 * HZ; t++) step(near, []);
    expect(near.soldiers.slice(0, 4).every((s) => s.vehicle < 0)).toBe(true);
  });

  it('a goal across the river fits the helicopter though short of heliFitM; one on its own bank never does', () => {
    // River field: E is 415 m from the nato HQ over a crossing (short of heliFitM 450); A is 228 m off on the HQ's own bank
    const heliRiders = (id: string, seed: number) => {
      const map = { ...RIVER_FIELD, points: RIVER_FIELD.points.filter((p) => p.id === id) };
      const tune: Tune = { ...DEFAULT_TUNE, squadSize: 4, speedJitter: 0, visionM: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 1, pointJeeps: false, rideM: [100, 100], ...NO_TRAITS, ...NO_TEMPO };
      const m = createMatch({ seed, map, tune, squadsPerSide: 1, commanderSide: 'nato' });
      for (let t = 0; t < 10 * HZ; t++) step(m, []);
      return m.soldiers.slice(0, 4).filter((s) => s.vehicle >= 0).length;
    };
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(heliRiders('E', seed), `across, seed ${seed}`).toBeGreaterThan(0);
      expect(heliRiders('A', seed), `own bank, seed ${seed}`).toBe(0);
    }
  });

  it('a full Squad and a piloted helicopter: three ride, the farthest walks Detached on the Squad\'s goal', () => {
    const m = scene({ helisPerSide: 1 }, { squads: 2, goal: -50 });
    const heli = m.vehicles.find((v) => v.side === 'nato')!;
    heli.seats[0] = 4; // Squad 1's Soldier 4 is the pilot
    Object.assign(m.soldiers[4]!, { vehicle: heli.id, x: heli.x, y: heli.y });
    Object.assign(m.soldiers[3]!, { x: -530, y: 0 }); // the farthest
    let detached = false;
    for (let t = 0; t < 8 * HZ; t++) {
      step(m, []);
      detached ||= m.soldiers[3]!.detached && m.soldiers[3]!.goal === -1 && m.soldiers[3]!.vehicle < 0;
    }
    expect(heli.seats.slice(1).sort()).toEqual([0, 1, 2]);
    expect(detached).toBe(true);
    // the others are aboard (and gone): the one left over stays Detached on the Squad's goal, then rejoins them there
    expect(m.soldiers[3]).toMatchObject({ detached: true, goal: -1, vehicle: -1 });
    let rejoined = -1;
    for (let t = 0; t < 200 * HZ && rejoined < 0; t++) {
      step(m, []);
      if (!m.soldiers[3]!.detached) rejoined = t;
    }
    expect(rejoined).toBeGreaterThan(0);
    expect(dist(m.soldiers[3]!, m.points[0]!)).toBeLessThan(m.points[0]!.radius + m.tune.rejoinM);
    expect(dist(m.soldiers[3]!, m.soldiers[0]!)).toBeLessThan(m.tune.rejoinM + 1);
  });

  it('two Squads never claim the same vehicle', () => {
    const m = scene({ jeepsPerSide: 1 }, { squads: 2 });
    const jeep = m.vehicles.find((v) => v.side === 'nato')!;
    const seen = new Set<number>();
    for (let t = 0; t < 12 * HZ; t++) {
      step(m, []);
      for (const id of jeep.seats) if (id >= 0) seen.add(m.soldiers[id]!.squad);
    }
    expect(seen.size).toBe(1);
  });
});

describe('#122 tanks stay crewed by pairs', () => {
  it('a Squad never rides a tank: two of four crew it, the rest stay on foot', () => {
    const m = scene({ tanksPerSide: 1 });
    for (let t = 0; t < 8 * HZ; t++) step(m, []);
    const tank = m.vehicles.find((v) => v.side === 'nato')!;
    expect(tank.seats.every((id) => id >= 0)).toBe(true);
    expect(m.soldiers.slice(0, 4).filter((s) => s.vehicle < 0)).toHaveLength(2);
  });
});
