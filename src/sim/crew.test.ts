import { describe, expect, it } from 'vitest';
import { createMatch, step, type Match } from './index';
import { boardOnReturn } from './vehicles';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import type { MapData, Tune } from './types';

// #129: helicopter crew: Soldiers from different Squads fly it and man its side guns for a stint, staying in their Squads.
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

/** Three nato Squads (Soldiers 0..11) up the field from their helicopter (vehicle 24, on the HQ); pact (12..23) parked out of sight. */
function scene(tune: Partial<Tune> = {}, seed = 3): Match {
  const full: Tune = { ...DEFAULT_TUNE, squadSize: 4, speedJitter: 0, spread: 0, strayChance: 0, visionM: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 1, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, rideM: [1e6, 1e6], ...NO_TRAITS, ...NO_TEMPO, ...tune };
  const m = thinkOnId(createMatch({ seed, map: field, tune: full, squadsPerSide: 3, commanderSide: 'nato' }));
  m.soldiers.forEach((s, i) => Object.assign(s, s.side === 'nato' ? { x: -540, y: 4 * (i % 4) - 6 + 10 * Math.floor(i / 4) } : FAR));
  m.soldiers.filter((s) => s.side === 'pact').forEach((s) => (s.speed = 0));
  return m;
}
const heliOf = (m: Match) => m.vehicles.find((v) => v.side === 'nato' && v.kind === 'helicopter')!;

describe('#129 crew', () => {
  it('pilot and both guns fill from different Squads, never a Squad Leader, each Detached but still a member', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = scene({}, seed);
      for (let t = 0; t < 40 * HZ; t++) step(m, []);
      const crew = heliOf(m).seats.slice(0, 3).map((id) => m.soldiers[id]!);
      expect(crew.every((s) => s), `seed ${seed}`).toBe(true);
      expect(new Set(crew.map((s) => s.squad)).size, `seed ${seed}`).toBe(3);
      for (const s of crew) {
        expect(m.squads[s.squad]!.members[0]).not.toBe(s.id);
        expect(m.squads[s.squad]!.members).toContain(s.id);
        expect(s.detached).toBe(true);
      }
    }
  });

  it('a crew member stays for the stint, gets out only on the pad, and rejoins the Squad', () => {
    const m = scene({ crewSeconds: [20, 20] });
    const heli = heliOf(m);
    let out = -1;
    let pilot = -1;
    for (let t = 0; t < 120 * HZ && out < 0; t++) {
      step(m, []);
      if (pilot < 0 && heli.seats[0]! >= 0) pilot = heli.seats[0]!;
      if (pilot >= 0 && heli.seats[0] !== pilot) out = m.tick;
    }
    const s = m.soldiers[pilot]!;
    expect(out).toBeGreaterThan(20 * HZ);
    expect(heli.airborne).toBe(false);
    expect(s.vehicle).toBe(-1);
    expect(m.squads[s.squad]!.members).toContain(pilot);
    expect(s.detached).toBe(true);
    for (let t = 0; t < 120 * HZ && s.detached; t++) step(m, []);
    expect(s.detached).toBe(false);
  });

  it('each recruit takes the seat they were sent for: a gun recruit arriving first leaves the pilot seat for the pilot recruit', () => {
    const m = scene({ mountSeconds: [1, 1] });
    const heli = heliOf(m);
    const sent: number[] = [];
    for (let t = 0; t < 60 * HZ && sent.length < 2; t++) {
      step(m, []);
      for (const s of m.soldiers) if (s.crew && s.boarding === heli.id && !sent.includes(s.id)) sent.push(s.id);
    }
    expect(sent).toHaveLength(2);
    Object.assign(m.soldiers[sent[1]!]!, { x: heli.x, y: heli.y }); // the second sent (a gun) is at the door; the pilot is still walking
    for (let t = 0; t < 4 * HZ && !heli.seats.includes(sent[1]!); t++) step(m, []);
    expect(heli.seats.includes(sent[1]!)).toBe(true);
    expect(heli.seats[0]).toBe(-1);
    for (let t = 0; t < 30 * HZ && heli.seats[0] !== sent[0]; t++) step(m, []);
    expect(heli.seats[0]).toBe(sent[0]);
  });

  it('a pilot whose stint is over stays while a claimed Squad is boarding or a passenger is aboard, and leaves once the helicopter is on its pad with neither', () => {
    for (const hold of ['claim', 'passenger', 'none'] as const) {
      const m = scene();
      m.squads.forEach((sq) => (sq.rideM = 1e9));
      const heli = heliOf(m);
      Object.assign(heli, { seats: [4, -1, -1, hold === 'passenger' ? 8 : -1, -1, -1], departAt: 1e9, ...(hold === 'claim' && { claim: 2, claimUntil: 1e9 }) });
      Object.assign(m.soldiers[4]!, { vehicle: heli.id, crew: true, crewSeat: 0, crewUntil: 0, x: heli.x, y: heli.y });
      if (hold === 'claim') Object.assign(m.soldiers[8]!, { boarding: heli.id, x: heli.x + 30, y: heli.y }); // Squad 2 is walking to it
      if (hold === 'passenger') Object.assign(m.soldiers[8]!, { vehicle: heli.id, x: heli.x, y: heli.y });
      for (let t = 0; t < 20 * HZ; t++) step(m, []);
      expect(heli.seats[0] === 4, hold).toBe(hold !== 'none');
    }
  });

  it('with no pilot the helicopter does not fly', () => {
    const m = scene({ rideM: [100, 100] });
    const heli = heliOf(m);
    const pos = { x: heli.x, y: heli.y };
    for (let t = 0; t < 5 * HZ; t++) {
      heli.seats[0] = -1; // nobody is allowed to pilot it
      step(m, []);
    }
    expect(heli).toMatchObject({ ...pos, airborne: false });
  });
});

describe('#129 side guns', () => {
  /** Soldiers 0 (pilot), 1 (left gun), 2 (right gun) aboard where `seats` say, heading east; pact's Soldier 12 stands at `at`. Who fired. */
  function fired(seats: number[], at: { x: number; y: number }) {
    const m = scene({ crewSeconds: [1e5, 1e5], hitChance: 1 });
    m.squads.forEach((sq) => (sq.rideM = 1e9)); // #131: no Squad calls the helicopter to fetch it: it stays where this test put it
    const heli = heliOf(m);
    Object.assign(heli, { x: 0, y: 0, fx: 1, fy: 0, slot: { x: 0, y: 0 }, seats });
    m.soldiers.slice(0, 12).forEach((s) => Object.assign(s, seats.includes(s.id) ? { x: 0, y: 0 } : { x: -500, y: -500 })); // the rest are far off
    seats.forEach((id) => id >= 0 && Object.assign(m.soldiers[id]!, { vehicle: heli.id, crew: true, crewUntil: 1e9 }));
    Object.assign(m.soldiers[12]!, { ...at, hp: 1e9 });
    const from = new Set<number>();
    for (let t = 0; t < 3 * HZ; t++) for (const e of step(m, [])) if (e.kind === 'shot' && e.side === 'nato') from.add(e.from);
    return from;
  }
  const six = [0, 1, 2, -1, -1, -1];

  it('each gun covers 120 degrees straight out from its side: nothing ahead or behind is in either arc', () => {
    expect(fired(six, { x: 0, y: 80 })).toEqual(new Set([1])); // heading east: left is +y
    expect(fired(six, { x: 0, y: -80 })).toEqual(new Set([2]));
    expect(fired(six, { x: 80, y: 0 })).toEqual(new Set());
    expect(fired(six, { x: -80, y: 0 })).toEqual(new Set());
    expect(fired(six, { x: 60, y: 80 })).toEqual(new Set([1])); // 37 degrees ahead of the beam: inside
    expect(fired(six, { x: 80, y: 30 })).toEqual(new Set()); // 69 degrees ahead of the beam: outside
  });

  it('an unmanned gun never fires', () => {
    expect(fired([0, -1, 2, -1, -1, -1], { x: 0, y: 80 })).toEqual(new Set());
    expect(fired([0, 1, -1, -1, -1, -1], { x: 0, y: -80 })).toEqual(new Set());
  });
});

describe('#129 passengers', () => {
  it('a Squad of four with only a pilot aboard rides in the three passenger seats and one gun seat', () => {
    const m = scene({ rideM: [100, 100] });
    m.points[0]!.x = -50; // 490 m off: past heliFitM
    const heli = heliOf(m);
    heli.seats[0] = 4; // Squad 1's Soldier 4 is the pilot
    Object.assign(m.soldiers[4]!, { vehicle: heli.id, crew: true, crewUntil: 1e9, x: heli.x, y: heli.y });
    m.soldiers.slice(5, 12).forEach((s) => Object.assign(s, { x: -400, y: 300 })); // the other Squads stay out of it
    let most = 0;
    for (let t = 0; t < 20 * HZ; t++) {
      step(m, []);
      most = Math.max(most, heli.seats.filter((id) => id >= 0 && id < 4).length);
    }
    expect(most).toBe(4);
  });
});

describe('#129 crew spawn', () => {
  /** Soldier `id` dies and comes back: the helicopter's crew seats after. */
  function back(id: number, tune: Partial<Tune>) {
    const m = scene(tune);
    const s = m.soldiers[id]!;
    boardOnReturn(m, m.squads[s.squad]!, s);
    return { m, s, seats: heliOf(m).seats.slice(0, 3) };
  }
  it('takes the pilot seat of a helicopter on its pad, its stint starting as it spawns in', () => {
    const { m, s, seats } = back(1, { crewSpawnChance: 1 });
    expect(seats[0]).toBe(1);
    expect(s).toMatchObject({ crew: true, vehicle: heliOf(m).id });
    expect(s.crewUntil).toBeGreaterThan(m.tick);
  });
  it('never when the chance is 0, nor the Squad Leader', () => {
    expect(back(1, { crewSpawnChance: 0 }).seats).toEqual([-1, -1, -1]);
    expect(back(0, { crewSpawnChance: 1 }).seats).toEqual([-1, -1, -1]);
  });
  it('at most one crew per Squad; another Squad takes the next seat', () => {
    const { m, seats } = back(1, { crewSpawnChance: 1 });
    boardOnReturn(m, m.squads[0]!, m.soldiers[2]!);
    expect(m.soldiers[2]!.crew).toBe(false);
    boardOnReturn(m, m.squads[1]!, m.soldiers[5]!);
    expect(heliOf(m).seats.slice(0, 3)).toEqual([seats[0], 5, -1]);
  });
});
