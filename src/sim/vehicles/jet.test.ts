// #110 the jet, at its module's interface: its Sortie (a stage the view does not show), its cannon and bombs on what its Side
// knows, dogfights, and #154 more than one a Side.
import { describe, expect, it } from 'vitest';
import { step, type Match } from '../index';
import type { OwnOf } from './body';
import { jetTarget, type Sortie } from './jet';
import { leave, type VehicleOf } from './index';
import { DEFAULT_TUNE } from '../tune';
import { hashes, scene as baseScene, vehicle, viewOf } from '../test-scene';
import type { SimEvent, Tune } from '../types';

type Jet = VehicleOf<'jet'>;

const HZ = DEFAULT_TUNE.hz;

/**
 * Open ground 1200 m across, one Capture Point A in the middle, HQs on the flanks; nobody sees anybody. Soldiers 0, 1 are
 * nato's, 2, 3 pact's (with `squadSize` 2); then the jets (nato 4, pact 5). Each Side's last Soldier takes off as its jet's
 * pilot at match start; unless `enemyJet` the pact's gets out at once (its jet stays at the base: nobody dies to come back
 * into it), and the pact's Soldiers start away from their HQ.
 */
function scene(tune: Partial<Tune> = {}, enemyJet = false, squads = 1): Match {
  const m = baseScene({ map: { points: [{ id: 'A', name: 'A', x: 0, y: 0 }] }, tune: { visionM: 0, jetsPerSide: 1, ...tune }, squads });
  if (enemyJet) return m;
  const jet = vehicle(m, 'jet', 'pact');
  leave(m, m.soldiers[jet.seats[0]!]!);
  jet.sortie.stage = 'idle';
  jet.airborne = false;
  for (const s of m.soldiers) if (s.side === 'pact') Object.assign(s, { x: 300, y: 300 });
  return m;
}

/** Steps up to `ticks` ticks, handing each tick's events to `each`; stops once the Match has a result. */
const run = (m: Match, ticks: number, each: (events: SimEvent[]) => void = () => {}) => {
  for (let i = 0; i < ticks && !m.result; i++) each(step(m, []));
};

describe('#110 the jet', () => {
  it('takes off with its pilot at match start; it flies 4 passes over A with 20 s turns, never into the enemy HQ circle, then rearms 90 s at the base; the enemy sees it only over the Play Area', () => {
    const m = scene();
    const jet = vehicle(m, 'jet');
    const hq = m.map.hqs.pact;
    const runs: { sortie: string; airborne: boolean; ticks: number }[] = [];
    let seenOver = 0;
    run(m, 300 * HZ, () => {
      const last = runs.at(-1);
      if (last?.sortie === jet.sortie.stage && last.airborne === jet.airborne) last.ticks++;
      else runs.push({ sortie: jet.sortie.stage, airborne: jet.airborne, ticks: 1 });
      expect(Math.hypot(jet.x - hq.x, jet.y - hq.y)).toBeGreaterThanOrEqual(DEFAULT_TUNE.hqRadius - 1e-6);
      const over = jet.airborne && Math.abs(jet.x) < 600 && Math.abs(jet.y) < 600;
      expect(viewOf(m, jet.id, 'pact') !== undefined, `tick ${m.tick}`).toBe(over);
      seenOver += +over;
    });
    expect(viewOf(m, jet.id)!.seats![0]).toBe(1);
    const pass = ['inbound', 'outbound', 'turning'];
    expect(runs.slice(0, 14).map((r) => r.sortie)).toEqual([...pass, ...pass, ...pass, ...pass, 'rearming', 'rearming']); // inbound from the first tick
    for (const r of runs.slice(0, 14).filter((r) => r.sortie === 'turning')) expect(r.ticks).toBe(DEFAULT_TUNE.jetTurnSeconds * HZ); // the first sortie's (the window may cut a later one)
    expect(runs[13]).toMatchObject({ airborne: false, ticks: DEFAULT_TUNE.jetRearmSeconds * HZ }); // at the base, then off again
    expect(runs[14]!.sortie).toBe('inbound');
    expect(seenOver).toBeGreaterThan(0);
  });

  it('fires at the nearest enemy the Side knows within the strip ahead, never at one it does not know or off the line', () => {
    const m = scene();
    const jet = vehicle(m, 'jet');
    Object.assign(jet, { x: -150, y: 0, fx: 1, fy: 0 });
    Object.assign(jet.sortie, { stage: 'inbound', at: { x: 0, y: 0 } });
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
    run(m, 60 * HZ, (e) => events.push(...e));
    const pilot = viewOf(m, vehicle(m, 'jet').id)!.seats![0];
    expect(events.some((e) => (e.kind === 'shot' || e.kind === 'suppressive') && e.from === pilot)).toBe(true);
    const bomb = events.find((e) => e.kind === 'impact' && e.asset === 'bomb') as Extract<SimEvent, { kind: 'impact' }> | undefined;
    expect(bomb).toBeDefined();
    expect(Math.hypot(bomb!.x, bomb!.y)).toBeLessThan(20);
  });

  it('fights the enemy jet it meets in the air: they chase, and one of them is hit', () => {
    const m = scene({ reactionSeconds: [0.2, 0.8] }, true);
    const jets = m.vehicles.filter((v): v is Jet => v.kind === 'jet');
    let fought = false;
    run(m, 90 * HZ, () => (fought ||= jets.some((v) => v.sortie.stage === 'dogfight')));
    expect(fought).toBe(true);
    expect(jets.some((v) => v.hp < DEFAULT_TUNE.jetHp || v.deadAt >= 0)).toBe(true); // nothing else in the match can hurt a jet
  });
});

describe('#154 more than one jet a Side', () => {
  it('three jets over three Squads have three different pilots, from three Squads, and take off on different ticks', () => {
    const m = scene({ jetsPerSide: 3 }, true, 3);
    const jets = m.vehicles.filter((v): v is Jet => v.kind === 'jet' && v.side === 'nato');
    const off = jets.map(() => -1);
    run(m, 120 * HZ, () => jets.forEach((v, k) => off[k]! < 0 && v.airborne && (off[k] = m.tick)));
    const pilots = jets.map((v) => viewOf(m, v.id)!.seats![0]!);
    expect(new Set(pilots).size).toBe(3);
    expect(new Set(pilots.map((id) => m.soldiers[id]!.squad)).size).toBe(3);
    expect(off[0]).toBe(1); // the first at match start
    expect(off.every((t) => t > 0)).toBe(true);
    expect(new Set(off).size).toBe(3);
  });

  it('with two enemy jets in reach, two friendly jets fight different ones', () => {
    const m = scene({ jetsPerSide: 2 }, true, 2);
    const jets = m.vehicles.filter((v): v is Jet => v.kind === 'jet');
    jets.forEach((v, k) => {
      Object.assign(v, { x: v.side === 'nato' ? -100 : 100, y: k % 2 ? 50 : -50, fx: v.side === 'nato' ? 1 : -1, fy: 0, airborne: true });
      Object.assign(v.sortie, { stage: 'inbound', until: -1, at: { x: 0, y: 0 } });
    });
    run(m, 1);
    const nato = jets.filter((v) => v.side === 'nato');
    expect(nato.map((v) => v.sortie.stage)).toEqual(['dogfight', 'dogfight']);
    expect(new Set(nato.map((v) => v.sortie.prey)).size).toBe(2);
  });
});

describe('#183 its hash', () => {
  it('mixes every field of its record: its sortie, and its missile\'s lock (aa.test.ts)', () => {
    const m = scene();
    const v = vehicle(m, 'jet');
    hashes<keyof OwnOf<'jet'>>(m, { sortie: () => (v.sortie.passes = 7), missile: () => (v.missile.lock = 5) });
    hashes<keyof Sortie>(m, {
      stage: () => (v.sortie.stage = 'turning'),
      passes: () => (v.sortie.passes = 3),
      bombs: () => (v.sortie.bombs = 1),
      prey: () => (v.sortie.prey = 2),
      at: () => (v.sortie.at = { x: 1, y: 2 }),
      turn: () => (v.sortie.turn = -1),
      until: () => (v.sortie.until = 99),
      bomb: () => (v.sortie.bomb = !v.sortie.bomb),
    });
  });
});
