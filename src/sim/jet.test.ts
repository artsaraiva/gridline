import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, type Match } from './index';
import { jetTarget } from './jet';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import type { Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/**
 * Open ground 1200 m across, one Capture Point A in the middle, HQs on the flanks; nobody sees anybody. Soldiers 0, 1 are
 * nato's, 2, 3 pact's; then the jets (nato 4, pact 5), then the AAs when `aasPerSide` says. Soldier 1 boards nato's jet at once.
 */
function scene(tune: Partial<Tune> = {}): Match {
  return thinkOnId(createMatch({
    seed: 1,
    map: { name: 'field', playArea: [{ x: -600, y: -600 }, { x: 600, y: -600 }, { x: 600, y: 600 }, { x: -600, y: 600 }], hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } }, points: [{ id: 'A', name: 'A', x: 0, y: 0 }] },
    tune: { ...DEFAULT_TUNE, squadSize: 2, spread: 0, speedJitter: 0, visionM: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, pointJeeps: false, aasPerSide: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], ...NO_TRAITS, ...NO_TEMPO, ...tune },
    squadsPerSide: 1,
    commanderSide: 'nato',
  }));
}

describe('#110 the jet', () => {
  it('a Soldier boards its slot at match start; it flies 4 passes over A with 20 s turns, never into the enemy HQ circle, then rearms 90 s at the base; the enemy sees it only over the Play Area', () => {
    const m = scene();
    const jet = m.vehicles[0]!;
    const hq = m.map.hqs.pact;
    const runs: { sortie: string; airborne: boolean; ticks: number }[] = [];
    let seenOver = 0;
    for (let i = 0; i < 300 * HZ; i++) {
      step(m, []);
      const last = runs.at(-1);
      if (last?.sortie === jet.sortie && last.airborne === jet.airborne) last.ticks++;
      else runs.push({ sortie: jet.sortie, airborne: jet.airborne, ticks: 1 });
      expect(Math.hypot(jet.x - hq.x, jet.y - hq.y)).toBeGreaterThanOrEqual(DEFAULT_TUNE.hqRadius - 1e-6);
      const over = jet.airborne && Math.abs(jet.x) < 600 && Math.abs(jet.y) < 600;
      expect(commanderView(m, 'pact').vehicles!.some((v) => v.id === jet.id), `tick ${m.tick}`).toBe(over);
      seenOver += +over;
    }
    expect(jet.seats[0]).toBe(1);
    const pass = ['inbound', 'outbound', 'turning'];
    expect(runs.slice(0, 14).map((r) => r.sortie)).toEqual([...pass, ...pass, ...pass, ...pass, 'rearming', 'rearming']); // inbound from the first tick
    for (const r of runs.filter((r) => r.sortie === 'turning')) expect(r.ticks).toBe(DEFAULT_TUNE.jetTurnSeconds * HZ);
    expect(runs[13]).toMatchObject({ airborne: false, ticks: DEFAULT_TUNE.jetRearmSeconds * HZ }); // at the base, then off again
    expect(runs[14]!.sortie).toBe('inbound');
    expect(seenOver).toBeGreaterThan(0);
  });

  it('fires at the nearest enemy the Side knows within the strip ahead, never at one it does not know or off the line', () => {
    const m = scene();
    const jet = m.vehicles[0]!;
    Object.assign(jet, { x: -150, y: 0, fx: 1, fy: 0, sortie: 'inbound', spot: { x: 0, y: 0 }, seats: [1] });
    Object.assign(m.soldiers[2]!, { x: -50, y: 5 });
    Object.assign(m.soldiers[3]!, { x: -60, y: 40 });
    const seen = (id: number) => ({ id, x: 0, y: 0, tick: m.tick, source: 'seen' as const });
    m.sightings.nato = [seen(3)];
    expect(jetTarget(m, jet)).toBeNull();
    m.sightings.nato = [seen(2), seen(3)];
    expect(jetTarget(m, jet)).toBe(m.soldiers[2]);
    jet.x = -250; // short of the strip
    expect(jetTarget(m, jet)).toBeNull();
  });
});

describe('#110 the AA', () => {
  it('parked on A, it shoots the jet down on its second pass: the pilot dies, one Ticket, a Wreck where it fell', () => {
    const m = scene({ aasPerSide: 1 });
    const [jet, aa] = [m.vehicles[0]!, m.vehicles[3]!];
    expect(aa).toMatchObject({ side: 'pact', kind: 'aa' });
    Object.assign(aa, { x: 0, y: 0, seats: [2] });
    Object.assign(m.soldiers[2]!, { x: 0, y: 0, vehicle: aa.id });
    const tickets = m.tickets.nato;
    let afterFirst = -1;
    for (let i = 0; i < 120 * HZ && jet.deadAt < 0; i++) {
      step(m, []);
      if (afterFirst < 0 && jet.sortie === 'turning') afterFirst = jet.hp;
    }
    expect(afterFirst).toBeGreaterThan(30);
    expect(afterFirst).toBeLessThan(70); // about half a pass
    expect(jet.deadAt).toBeGreaterThan(0);
    expect(jet.passes).toBeGreaterThanOrEqual(2); // during the second pass
    expect(m.soldiers[1]!.state).toBe('dead');
    expect(m.tickets.nato).toBe(tickets - 1);
    expect(m.wrecks).toContainEqual(expect.objectContaining({ side: 'nato', kind: 'jet' }));
  });
});
