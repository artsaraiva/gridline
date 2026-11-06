import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;
const AT: Vec2 = { x: 100, y: 50 };

/** Open ground, HQs far out on the flanks, no Capture Points (as barrage.test.ts). */
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
};

const ONE_SHELL: Partial<Tune> = { barrageShells: 1, walkSpeed: 0 };

/** nato Soldiers 0..5, pact 6..11. Nobody fires unless `fireRangeM` is given; one shell, nobody walks. */
function scene(place: Record<number, Vec2> = {}, tune: Partial<Tune> = {}): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, barrageCooldownSeconds: 0, ...ONE_SHELL, ...tune };
  const m = createMatch({ seed: 1, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const barrage = (m: Match): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'barrage', at: AT });

/** Calls the Barrage on the first step, then steps `ticks` in all; returns every event. */
function play(m: Match, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(m, i === 0 ? [barrage(m)] : []));
  return events;
}

const awards = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { kind: 'award' }> => e.kind === 'award');

/** Where the one shell lands, by a dry run on the same seed. */
const landing = (): Vec2 => {
  const { x, y } = play(scene(), 16 * HZ).find((e): e is Extract<SimEvent, { kind: 'impact' }> => e.kind === 'impact')!;
  return { x, y };
};
const LAND_TICK = 6.5 * HZ; // 2.5 s warning + 4 s flight

describe('Commander Score: Artillery', () => {
  it('a Barrage kill of an enemy awards the artillery kill value to the caller, and the view carries the totals', () => {
    const at = landing();
    const m = scene({ 6: at });
    const events = play(m, LAND_TICK + 1);
    expect(awards(events)).toEqual([{ kind: 'award', side: 'nato', category: 'artillery', points: 100, reason: 'Barrage kill' }]);
    expect(commanderView(m, 'nato').score).toEqual({ total: 100, uav: 0, supply: 0, artillery: 100, orders: 0 });
    expect(commanderView(m, 'pact').score).toEqual({ total: 0, uav: 0, supply: 0, artillery: 0, orders: 0 });
  });

  it('a Barrage Wounding that bleeds out awards once, on the death', () => {
    const at = landing();
    const m = scene({ 6: { x: at.x + 6, y: at.y } }); // Wounded, not killed; no squad mate in revive range
    const before = play(m, LAND_TICK + 1);
    expect(before.some((e) => e.kind === 'wounded' && e.id === 6)).toBe(true);
    expect(awards(before)).toEqual([]);
    const after = play(m, DEFAULT_TUNE.bleedOutSeconds * HZ + 1);
    expect(after.some((e) => e.kind === 'death' && e.id === 6)).toBe(true);
    expect(awards(after)).toEqual([{ kind: 'award', side: 'nato', category: 'artillery', points: 100, reason: 'Barrage kill' }]);
    expect(commanderView(m, 'nato').score!.artillery).toBe(100);
  });

  it('Wounding alone awards nothing', () => {
    const at = landing();
    const m = scene({ 6: { x: at.x + 6, y: at.y } });
    play(m, LAND_TICK + 1);
    expect(commanderView(m, 'nato').score).toEqual({ total: 0, uav: 0, supply: 0, artillery: 0, orders: 0 });
  });

  it('a Revive clears the Barrage attribution: the Soldier later shot down and bleeding out awards nothing', () => {
    const at = landing();
    // pact 7 stands 1.6 m beyond 6: clear of the Wound radius, pinned by the blast for a moment, then revives 6
    const m = scene({ 6: { x: at.x + 7.9, y: at.y }, 7: { x: at.x + 9.5, y: at.y } });
    const events = play(m, LAND_TICK + 6 * HZ);
    expect(events.some((e) => e.kind === 'revived' && e.id === 6)).toBe(true);
    // the mate walks off; three NATO riflemen appear 100 m west of 6, in each other's sight, and shoot them down
    Object.assign(m.soldiers[7]!, { x: at.x + 200, y: at.y });
    for (const id of [0, 1, 2]) Object.assign(m.soldiers[id]!, { x: at.x - 100, y: at.y + id * 3 });
    m.tune.fireRangeM = 140;
    for (let i = 0; i < 40 * HZ && m.soldiers[6]!.state !== 'dead'; i++) events.push(...step(m, []));
    expect(m.soldiers[6]!.state).toBe('dead');
    expect(awards(events)).toEqual([]);
  });

  it('a Soldier Wounded by one shell and killed by another is one kill, never two awards', () => {
    // two Barrages called together: their shells land on the same tick; the second is aimed so its shell lands 6 m past the first's, on Soldier 6
    const twice = (second: Vec2) => {
      const m = scene();
      const cmds = [barrage(m), { ...barrage(m), at: second }];
      return { m, spots: step(m, cmds) };
    };
    const dry = scene();
    const first = [barrage(dry), barrage(dry)];
    const events: SimEvent[] = [];
    for (let i = 0; i < LAND_TICK + 1; i++) events.push(...step(dry, i === 0 ? first : []));
    const [l1, l2] = events.filter((e): e is Extract<SimEvent, { kind: 'impact' }> => e.kind === 'impact');
    const victim = { x: l1!.x + 6, y: l1!.y };
    const { m } = twice({ x: AT.x + (victim.x - l2!.x), y: AT.y + (victim.y - l2!.y) });
    Object.assign(m.soldiers[6]!, victim);
    const run: SimEvent[] = [];
    for (let i = 1; i < LAND_TICK + 1; i++) run.push(...step(m, []));
    expect(run.filter((e) => e.kind === 'impact')).toHaveLength(2);
    expect(run.filter((e) => e.kind === 'death')).toEqual([{ kind: 'death', side: 'pact', id: 6, x: victim.x, y: victim.y }]);
    expect(awards(run)).toHaveLength(1);
    expect(commanderView(m, 'nato').score!.artillery).toBe(100);
  });

  it('the score is part of the state hash', () => {
    const at = landing();
    const m = scene({ 6: at });
    play(m, LAND_TICK + 1);
    const scored = stateHash(m);
    m.score.nato.artillery = 0;
    expect(stateHash(m)).not.toBe(scored);
  });
});
