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
function scene(place: Record<number, Vec2 & { fx?: number }> = {}, tune: Partial<Tune> = {}): Match {
  const t: Tune = { ...DEFAULT_TUNE, squadSize: 6, speedJitter: 0, spread: 0, fireRangeM: 0, barrageCooldownSeconds: 0, ...ONE_SHELL, ...tune };
  const m = createMatch({ seed: 1, map: field, tune: t, squadsPerSide: 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const barrage = (m: Match, side: 'nato' | 'pact' = 'nato', at: Vec2 = AT): Command => ({ tick: m.tick, side, kind: 'asset', asset: 'barrage', at });

/** Sends `first` (the Barrage by default) on the first step, then steps `ticks` in all; returns every event. */
function play(m: Match, ticks: number, first: Command[] = [barrage(m)]): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(m, i === 0 ? first : []));
  return events;
}

const awards = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { kind: 'award' }> => e.kind === 'award');

/** Where the one shell lands, by a dry run on the same seed. */
const landing = (): Vec2 => {
  const { x, y } = play(scene(), 16 * HZ).find((e): e is Extract<SimEvent, { kind: 'impact' }> => e.kind === 'impact')!;
  return { x, y };
};
const LAND_TICK = 14 * HZ; // 10 s warning + 4 s flight

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

  it('an enemy Wounded by rifle fire that bleeds out lying in the Wound ring is no Barrage kill', () => {
    const at = landing();
    // nato 0 stands 100 m west of pact 6 (facing away) and shoots it down as the Barrage is called; the shell lands 6 m from it while it bleeds
    const m = scene({ 6: { x: at.x + 6, y: at.y, fx: 1 }, 0: { x: at.x - 94, y: at.y } }, { hitChance: 1, damage: [100, 100], fireRangeM: 140 });
    expect(play(m, 2).some((e) => e.kind === 'wounded' && e.id === 6)).toBe(true);
    const rest = play(m, LAND_TICK + DEFAULT_TUNE.bleedOutSeconds * HZ, []);
    expect(rest.some((e) => e.kind === 'impact')).toBe(true);
    expect(rest.some((e) => e.kind === 'death' && e.id === 6)).toBe(true);
    expect(awards(rest)).toEqual([]);
  });

  it("a Soldier Wounded by the enemy's Barrage and killed by its own Side's earns the enemy nothing", () => {
    const at = landing();
    const victim = { x: at.x + 6, y: at.y };
    // dry run: nato's shell Wounds 6, then pact calls a Barrage on the same spot; learn where its shell lands.
    // 6 must still be bleeding 14 s later when pact's shell lands, so it bleeds slowly here.
    const slow = { bleedOutSeconds: 30 };
    const dry = scene({ 6: victim }, slow);
    play(dry, LAND_TICK + 1);
    const l2 = play(dry, LAND_TICK + 1, [barrage(dry, 'pact')]).find((e): e is Extract<SimEvent, { kind: 'impact' }> => e.kind === 'impact')!;
    // the same again, pact's Barrage aimed so its shell lands on 6
    const m = scene({ 6: victim }, slow);
    const before = play(m, LAND_TICK + 1);
    expect(before.some((e) => e.kind === 'wounded' && e.id === 6)).toBe(true);
    const after = play(m, LAND_TICK + 1, [barrage(m, 'pact', { x: AT.x + (victim.x - l2.x), y: AT.y + (victim.y - l2.y) })]);
    expect(after.filter((e) => e.kind === 'death')).toEqual([{ kind: 'death', side: 'pact', id: 6, x: victim.x, y: victim.y }]);
    expect(awards([...before, ...after])).toEqual([]);
  });
});

describe('Commander Score: UAV assist', () => {
  // pact 6 stands at V facing away from NATO, out of everyone's sight; a 1 s Scan on V reveals it. Bringing nato 0 in
  // 100 m west of it stands in for walking up: it sees 6, shoots it down with one round, and 6 bleeds out 8 s later.
  const V: Vec2 = { x: 200, y: 0 };
  const SCAN: Partial<Tune> = { hitChance: 1, damage: [100, 100], fireRangeM: 140, scanSeconds: 1, scanCooldownSeconds: 0 };
  const WINDOW = (1 + DEFAULT_TUNE.scoreUavGraceSeconds) * HZ; // the Scan plus the grace after it
  const scan = (m: Match, at: Vec2 = V): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'scan', at });
  const uavScene = (place: Record<number, Vec2 & { fx?: number }> = {}) => scene({ 6: { ...V, fx: 1 }, ...place }, SCAN);
  const shooterIn = (m: Match) => Object.assign(m.soldiers[0]!, { x: V.x - 100, y: V.y });
  const shooterOut = (m: Match) => Object.assign(m.soldiers[0]!, { x: field.hqs.nato.x, y: 0 });
  /** Steps until pact 6 is dead (at most 20 s); every event. */
  const untilDead = (m: Match) => {
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * HZ && m.soldiers[6]!.state !== 'dead'; i++) events.push(...step(m, []));
    expect(m.soldiers[6]!.state).toBe('dead');
    return events;
  };
  const UAV_ASSIST = { kind: 'award', side: 'nato', category: 'uav', points: 50, reason: 'UAV assist' };

  it('an enemy only the UAV revealed, shot down while it tracks it, awards the assist on the death, even one bled out after the window', () => {
    const m = uavScene();
    play(m, HZ / 2, [scan(m)]);
    shooterIn(m);
    const events = untilDead(m);
    expect(events.find((e) => e.kind === 'wounded' && e.id === 6)).toBeTruthy();
    expect(m.tick).toBeGreaterThan(WINDOW);
    expect(awards(events)).toEqual([UAV_ASSIST]);
    expect(commanderView(m, 'nato').score).toEqual({ total: 50, uav: 50, supply: 0, artillery: 0, orders: 0 });
  });

  it('an enemy a Soldier already sees when the UAV reveals it awards nothing', () => {
    const m = uavScene();
    shooterIn(m);
    play(m, 1, [scan(m)]); // nato 0 sees 6 as the Scan arrives, and shoots it down this very tick
    expect(m.soldiers[6]!.state).toBe('wounded');
    untilDead(m);
    expect(commanderView(m, 'nato').score!.uav).toBe(0);
  });

  it('two UAVs over the same enemy award once', () => {
    const m = uavScene();
    play(m, HZ / 2, [scan(m), scan(m, { x: V.x + 10, y: V.y })]);
    expect(m.assets.effects).toHaveLength(2);
    shooterIn(m);
    expect(awards(untilDead(m))).toEqual([UAV_ASSIST]);
  });

  it('watched by a Soldier from the UAV on, shot down within the grace after the UAV left awards; after the grace ran out it does not', () => {
    const downedAt = (tick: number) => {
      // nato 1 comes to watch 6 from 145 m, out of rifle range, while the UAV still has it: sight takes over with no gap
      const m = uavScene();
      play(m, HZ / 2, [scan(m)]);
      Object.assign(m.soldiers[1]!, { x: V.x - 145, y: V.y });
      play(m, tick - HZ / 2, []);
      expect(m.assets.effects).toEqual([]);
      shooterIn(m);
      return awards(untilDead(m));
    };
    expect(downedAt(WINDOW - 2 * HZ)).toEqual([UAV_ASSIST]);
    expect(downedAt(WINDOW + 2 * HZ)).toEqual([]);
  });

  it('out of all eyes for a moment after the UAV left and found again by a Soldier alone, it awards nothing even within the grace', () => {
    const m = uavScene();
    play(m, 2 * HZ, [scan(m)]); // the 1 s Scan is over, nobody has seen 6 for a second
    expect(m.assets.effects).toEqual([]);
    shooterIn(m);
    expect(m.tick).toBeLessThan(WINDOW - HZ);
    expect(awards(untilDead(m))).toEqual([]);
  });

  it('a Revive clears the eligibility: shot down again after the window and bleeding out, the Soldier awards nothing', () => {
    // pact 7 stands at 6's side, facing away like it, and revives it once the shooter has gone
    const m = uavScene({ 7: { x: V.x + 1.5, y: V.y, fx: 1 } });
    play(m, HZ / 2, [scan(m)]);
    shooterIn(m);
    const events = play(m, 1, []);
    expect(events.find((e) => e.kind === 'wounded')).toMatchObject({ id: 6 });
    shooterOut(m);
    events.push(...play(m, 5 * HZ, []));
    expect(events.find((e) => e.kind === 'revived')).toMatchObject({ id: 6 });
    events.push(...play(m, WINDOW, []));
    shooterIn(m);
    events.push(...untilDead(m));
    expect(awards(events)).toEqual([]);
  });

  it('an enemy lost to all eyes and found again by a Soldier alone awards nothing', () => {
    // nato 0 watches 6 from 145 m, out of rifle range, while the UAV is over it; leaves for longer than the grace; comes back and shoots
    const m = uavScene();
    Object.assign(m.soldiers[0]!, { x: V.x - 145, y: V.y });
    const events = play(m, HZ, [scan(m)]);
    expect(events.find((e) => e.kind === 'shot')).toBeUndefined();
    shooterOut(m);
    play(m, WINDOW, []);
    shooterIn(m);
    expect(awards(untilDead(m))).toEqual([]);
  });

  it('UAV discovery is part of the state hash', () => {
    const m = uavScene();
    play(m, HZ / 2, [scan(m)]);
    const discovered = stateHash(m);
    m.soldiers[6]!.uavUntil = -1;
    expect(stateHash(m)).not.toBe(discovered);
  });
});

describe('Commander Score: Supply', () => {
  const { hp: HP, ammo: AMMO, scoreSupplyPerFraction: PER, scoreSupplyCapPerRecipient: CAP } = DEFAULT_TUNE;
  const low = { ammo: 10, hp: 40 };
  const drop = (m: Match, side: 'nato' | 'pact' = 'nato'): Command => ({ tick: m.tick, side, kind: 'asset', asset: 'supply', at: AT });
  const supplyOf = (m: Match) => commanderView(m, 'nato').score!.supply;
  /** nato 0 stands 3 m from the drop spot, low on both; nato 1 full on the other side of it; the rest 100 m off. The crate can be called again at once. */
  const crateScene = (tune: Partial<Tune> = {}) => scene({ 0: { x: AT.x + 3, y: AT.y, ...low }, 1: { x: AT.x - 3, y: AT.y }, 2: { x: AT.x + 100, y: AT.y + 3 }, 3: { x: AT.x + 100, y: AT.y + 6 }, 4: { x: AT.x + 100, y: AT.y + 9 }, 5: { x: AT.x + 100, y: AT.y + 12 } }, { supplyCooldownSeconds: 0, ...tune });
  const run = (m: Match, ticks: number, cmds: Command[] = []) => {
    const events: SimEvent[] = [];
    for (let i = 0; i < ticks; i++) events.push(...step(m, i === 0 ? cmds : []));
    return events;
  };
  const LANDED = DEFAULT_TUNE.supplyFallSeconds * HZ;
  /** nato 0 steps out of the crate, runs low again and steps back in, `n` times: each visit is worth about a third of the cap. */
  const revisit = (m: Match, n: number) => {
    const events: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      Object.assign(m.soldiers[0]!, { x: AT.x + 100 });
      events.push(...run(m, 1));
      Object.assign(m.soldiers[0]!, { x: AT.x + 3, ...low });
      events.push(...run(m, 1));
    }
    return events;
  };

  it('awards the per-fraction value times the health and ammo fractions the crate actually restores', () => {
    const m = crateScene();
    run(m, LANDED + HZ, [drop(m)]); // lands, then heals for a second
    const healed = m.soldiers[0]!.hp - low.hp;
    expect(healed).toBeGreaterThan(0);
    expect(supplyOf(m)).toBeCloseTo(PER * (healed / HP + (AMMO - low.ammo) / AMMO), 6);
    expect(commanderView(m, 'pact').score!.supply).toBe(0);
  });

  it('a full-health, full-ammo recipient earns nothing', () => {
    const m = crateScene();
    Object.assign(m.soldiers[0]!, { hp: HP, ammo: AMMO });
    run(m, LANDED + 10 * HZ, [drop(m)]);
    expect(supplyOf(m)).toBe(0);
  });

  it('caps per recipient per drop across leaving, returning and respawning; restoration goes on past the cap', () => {
    const m = crateScene();
    const s = m.soldiers[0]!;
    const refill = PER * (1 - low.ammo / AMMO); // one visit's ammo refill alone is a good part of the cap
    run(m, LANDED + 1, [drop(m)]);
    expect(supplyOf(m)).toBeCloseTo(refill + PER * (DEFAULT_TUNE.supplyHealPerSecond / HZ / HP), 6);
    // leaves, spends and bleeds, comes back: the same allowance carries on
    Object.assign(s, { x: AT.x + 100 });
    run(m, HZ);
    Object.assign(s, { x: AT.x + 3, ...low });
    run(m, HZ);
    expect(supplyOf(m)).toBeGreaterThan(2 * refill);
    // two more visits reach the cap; the crate keeps healing and refilling
    revisit(m, 2);
    run(m, 2 * HZ);
    expect(supplyOf(m)).toBe(CAP);
    expect(s.ammo).toBe(AMMO);
    expect(s.hp).toBeGreaterThan(low.hp);
    // dies and respawns next to Soldier 1 at the crate, wounded again: still nothing past the cap
    Object.assign(s, { state: 'dead', deadAt: m.tick });
    const events = run(m, 12 * HZ);
    expect(events.some((e) => e.kind === 'respawn' && e.id === 0)).toBe(true);
    Object.assign(s, low);
    run(m, 5 * HZ);
    expect(s.ammo).toBe(AMMO);
    expect(supplyOf(m)).toBe(CAP);
  });

  it('a second drop has a fresh allowance', () => {
    const m = crateScene();
    run(m, LANDED + 1, [drop(m)]);
    revisit(m, 4);
    expect(supplyOf(m)).toBe(CAP);
    run(m, DEFAULT_TUNE.supplyStaySeconds * HZ); // the first crate is gone
    Object.assign(m.soldiers[0]!, low);
    run(m, LANDED + 1, [drop(m)]);
    expect(supplyOf(m)).toBeGreaterThan(CAP + PER * (1 - low.ammo / AMMO));
  });

  it('tells the Console each time a recipient stops drawing and at the cap, naming the Squad: the messages add up to the cap, then stop', () => {
    const m = crateScene();
    const early = run(m, LANDED + 1, [drop(m)]);
    expect(awards(early)).toEqual([]); // the ledger moves, the Console waits
    expect(supplyOf(m)).toBeGreaterThan(0);
    const visits = awards(revisit(m, 4));
    expect(supplyOf(m)).toBe(CAP);
    expect(visits.length).toBeGreaterThan(1);
    for (const a of visits) expect(a).toMatchObject({ kind: 'award', side: 'nato', category: 'supply', reason: 'Supply Drop resupplied Alpha' });
    expect(visits.reduce((n, a) => n + a.points, 0)).toBeCloseTo(CAP, 6);
    expect(awards(run(m, DEFAULT_TUNE.supplyStaySeconds * HZ))).toEqual([]);
  });

  it('#153: a recipient whose Squad is not Elite is not named', () => {
    const m = crateScene({ eliteSquads: 0 });
    run(m, LANDED + 1, [drop(m)]);
    const visits = awards(revisit(m, 4));
    expect(visits.length).toBeGreaterThan(0);
    for (const a of visits) expect(a).toMatchObject({ category: 'supply', reason: 'Supply Drop resupplied friendlies' });
  });

  it('a recipient that leaves before the cap hears what it drew the tick after it stops drawing, and nothing more until it draws again', () => {
    const m = crateScene();
    expect(awards(run(m, LANDED + HZ, [drop(m)]))).toEqual([]);
    const drawn = supplyOf(m);
    expect(drawn).toBeGreaterThan(0);
    Object.assign(m.soldiers[0]!, { x: AT.x + 100 });
    const [a, ...more] = awards(run(m, 1));
    expect(more).toEqual([]);
    expect(a).toMatchObject({ side: 'nato', category: 'supply', reason: 'Supply Drop resupplied Alpha' });
    expect(a!.points).toBeCloseTo(drawn, 6);
    expect(awards(run(m, 2 * HZ))).toEqual([]);
  });

  it('a recipient short of the cap still drawing when the crate goes hears its total then', () => {
    const m = crateScene({ supplyHealPerSecond: 0.5 }); // nato 0 is still healing when the crate goes
    expect(awards(run(m, LANDED + DEFAULT_TUNE.supplyStaySeconds * HZ - 1, [drop(m)]))).toEqual([]);
    const events = run(m, 2);
    const [a, ...more] = awards(events);
    expect(more).toEqual([]);
    expect(a).toMatchObject({ side: 'nato', category: 'supply', reason: 'Supply Drop resupplied Alpha' });
    expect(a!.points).toBeCloseTo(supplyOf(m), 6);
    expect(commanderView(m, 'nato').effects).toEqual([]);
  });

  it('the allowance is part of the state hash', () => {
    const m = crateScene();
    run(m, LANDED + HZ, [drop(m)]);
    const drawn = stateHash(m);
    const crate = m.assets.effects.find((e) => e.asset === 'supply')!;
    crate.given![0] = 0;
    expect(stateHash(m)).not.toBe(drawn);
  });
});
