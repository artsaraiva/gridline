import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, type Match } from './index';
import { jetTarget } from './jet';
import { leave } from './vehicles';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import type { SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/**
 * Open ground 1200 m across, one Capture Point A in the middle, HQs on the flanks; nobody sees anybody. Soldiers 0, 1 are
 * nato's, 2, 3 pact's (with `squadSize` 2); then the jets (nato 4, pact 5), then the AAs when `aasPerSide` says. Each Side's
 * last Soldier takes off as its jet's pilot at match start; unless `enemyJet` the pact's gets out at once (its jet stays at
 * the base: nobody dies to come back into it), and the pact's Soldiers start away from their HQ.
 */
function scene(tune: Partial<Tune> = {}, enemyJet = false, squads = 1): Match {
  const m = thinkOnId(createMatch({
    seed: 1,
    map: { name: 'field', playArea: [{ x: -600, y: -600 }, { x: 600, y: -600 }, { x: 600, y: 600 }, { x: -600, y: 600 }], hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } }, points: [{ id: 'A', name: 'A', x: 0, y: 0 }] },
    tune: { ...DEFAULT_TUNE, squadSize: 2, spread: 0, speedJitter: 0, visionM: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, pointJeeps: false, jetsPerSide: 1, aasPerSide: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], ...NO_TRAITS, ...NO_TEMPO, ...tune },
    squadsPerSide: squads,
    commanderSide: 'nato',
  }));
  if (enemyJet) return m;
  const jet = m.vehicles.find((v) => v.kind === 'jet' && v.side === 'pact')!;
  leave(m, m.soldiers[jet.seats[0]!]!);
  Object.assign(jet, { sortie: 'idle', airborne: false });
  for (const s of m.soldiers) if (s.side === 'pact') Object.assign(s, { x: 300, y: 300 });
  return m;
}

const play = (m: Match, ticks: number, each: (events: SimEvent[]) => void = () => {}) => {
  for (let i = 0; i < ticks && !m.result; i++) each(step(m, []));
};

describe('#110 the jet', () => {
  it('takes off with its pilot at match start; it flies 4 passes over A with 20 s turns, never into the enemy HQ circle, then rearms 90 s at the base; the enemy sees it only over the Play Area', () => {
    const m = scene();
    const jet = m.vehicles[0]!;
    const hq = m.map.hqs.pact;
    const runs: { sortie: string; airborne: boolean; ticks: number }[] = [];
    let seenOver = 0;
    play(m, 300 * HZ, () => {
      const last = runs.at(-1);
      if (last?.sortie === jet.sortie && last.airborne === jet.airborne) last.ticks++;
      else runs.push({ sortie: jet.sortie, airborne: jet.airborne, ticks: 1 });
      expect(Math.hypot(jet.x - hq.x, jet.y - hq.y)).toBeGreaterThanOrEqual(DEFAULT_TUNE.hqRadius - 1e-6);
      const over = jet.airborne && Math.abs(jet.x) < 600 && Math.abs(jet.y) < 600;
      expect(commanderView(m, 'pact').vehicles!.some((v) => v.id === jet.id), `tick ${m.tick}`).toBe(over);
      seenOver += +over;
    });
    expect(jet.seats[0]).toBe(1);
    const pass = ['inbound', 'outbound', 'turning'];
    expect(runs.slice(0, 14).map((r) => r.sortie)).toEqual([...pass, ...pass, ...pass, ...pass, 'rearming', 'rearming']); // inbound from the first tick
    for (const r of runs.slice(0, 14).filter((r) => r.sortie === 'turning')) expect(r.ticks).toBe(DEFAULT_TUNE.jetTurnSeconds * HZ); // the first sortie's (the window may cut a later one)
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

  it('makes attack runs on what its Side sees: the cannon on the group by A, and on a later pass a bomb on it', () => {
    // Four a Side, nobody moves or fires a rifle; nato's Squad Leader looks at the pact Squad standing on A
    const m = scene({ squadSize: 4, visionM: DEFAULT_TUNE.visionM, walkSpeed: 0, fireRangeM: 0 });
    Object.assign(m.soldiers[0]!, { x: -60, y: 0, fx: 1, fy: 0 });
    [[0, 0], [4, 3], [-3, 4], [2, -4]].forEach(([x, y], k) => Object.assign(m.soldiers[4 + k]!, { x, y }));
    const events: SimEvent[] = [];
    play(m, 60 * HZ, (e) => events.push(...e));
    const pilot = m.vehicles.find((v) => v.kind === 'jet' && v.side === 'nato')!.seats[0];
    expect(events.some((e) => (e.kind === 'shot' || e.kind === 'suppressive') && e.from === pilot)).toBe(true);
    const bomb = events.find((e) => e.kind === 'impact' && e.asset === 'bomb') as Extract<SimEvent, { kind: 'impact' }> | undefined;
    expect(bomb).toBeDefined();
    expect(Math.hypot(bomb!.x, bomb!.y)).toBeLessThan(20);
  });

  it('fights the enemy jet it meets in the air: they chase, and one of them is hit', () => {
    const m = scene({ reactionSeconds: [0.2, 0.8] }, true);
    const jets = m.vehicles.filter((v) => v.kind === 'jet');
    let fought = false;
    play(m, 90 * HZ, () => (fought ||= jets.some((v) => v.sortie === 'dogfight')));
    expect(fought).toBe(true);
    expect(jets.some((v) => v.hp < DEFAULT_TUNE.jetHp || v.deadAt >= 0)).toBe(true); // nothing else in the match can hurt a jet
  });
});

describe('#154 more than one jet a Side', () => {
  it('three jets over three Squads have three different pilots, from three Squads, and take off on different ticks', () => {
    const m = scene({ jetsPerSide: 3 }, true, 3);
    const jets = m.vehicles.filter((v) => v.kind === 'jet' && v.side === 'nato');
    const off = jets.map(() => -1);
    play(m, 120 * HZ, () => jets.forEach((v, k) => off[k]! < 0 && v.airborne && (off[k] = m.tick)));
    const pilots = jets.map((v) => v.seats[0]!);
    expect(new Set(pilots).size).toBe(3);
    expect(new Set(pilots.map((id) => m.soldiers[id]!.squad)).size).toBe(3);
    expect(off[0]).toBe(1); // the first at match start
    expect(off.every((t) => t > 0)).toBe(true);
    expect(new Set(off).size).toBe(3);
  });

  it('with two enemy jets in reach, two friendly jets fight different ones', () => {
    const m = scene({ jetsPerSide: 2 }, true, 2);
    const jets = m.vehicles.filter((v) => v.kind === 'jet');
    jets.forEach((v, k) => Object.assign(v, { x: v.side === 'nato' ? -100 : 100, y: k % 2 ? 50 : -50, fx: v.side === 'nato' ? 1 : -1, fy: 0, sortie: 'inbound', airborne: true, until: -1, spot: { x: 0, y: 0 } }));
    play(m, 1);
    const nato = jets.filter((v) => v.side === 'nato');
    expect(nato.map((v) => v.sortie)).toEqual(['dogfight', 'dogfight']);
    expect(new Set(nato.map((v) => v.prey)).size).toBe(2);
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
    play(m, 120 * HZ, () => {
      if (afterFirst < 0 && jet.sortie === 'turning') afterFirst = jet.hp;
      if (jet.deadAt >= 0) m.result = { winner: 'pact', reason: 'tickets' }; // stop there
    });
    expect(afterFirst).toBeGreaterThan(20);
    expect(afterFirst).toBeLessThan(80); // about half a pass
    expect(jet.deadAt).toBeGreaterThan(0);
    expect(jet.passes).toBeGreaterThanOrEqual(2); // during the second pass
    expect(m.soldiers[1]!.state).toBe('dead');
    expect(m.tickets.nato).toBe(tickets - 1);
    expect(m.wrecks).toContainEqual(expect.objectContaining({ side: 'nato', kind: 'jet' }));
  });
});
