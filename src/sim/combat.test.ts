import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, MapData, SideId, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks, no Capture Points unless given. */
function field(extra: Partial<MapData> = {}): MapData {
  return {
    name: 'field',
    playArea: [
      { x: -600, y: -600 },
      { x: 600, y: -600 },
      { x: 600, y: 600 },
      { x: -600, y: 600 },
    ],
    hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
    points: [],
    ...extra,
  };
}

interface Placement {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
}

/**
 * Sets up a scenario. Soldier ids run nato first, squad by squad, `squadSize` each; every Soldier not
 * placed stays at its HQ, far from the fight. Placing Soldiers is the only reach past the Simulation
 * interface: it stands in for a map script, everything after it runs through `step`.
 */
function scene(o: { place: Record<number, Placement>; tune?: Partial<Tune>; map?: Partial<MapData>; squads?: number; seed?: number }): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 1, speedJitter: 0, spread: 0, tanksPerSide: 0, jeepsPerSide: 0, pointJeeps: false, ...o.tune }; // #107 #108: no vehicles
  const m = createMatch({ seed: o.seed ?? 1, map: field(o.map), tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(o.place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

/** Every shot hits and a single hit Wounds. */
const ONE_SHOT: Partial<Tune> = { hitChance: 1, damage: [100, 100] };

type Logged = SimEvent & { tick: number };

/** Steps `ticks` times; returns every event (with its tick) and `side`'s Commander view after every step. */
function play(m: Match, ticks: number, side: SideId = 'nato'): { events: Logged[]; views: CommanderView[] } {
  const events: Logged[] = [];
  const views: CommanderView[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    for (const e of step(m, [])) events.push({ ...e, tick });
    views.push(commanderView(m, side));
  }
  return { events, views };
}

/** The events of one kind, optionally from one Side. */
const of = <K extends SimEvent['kind']>(events: Logged[], kind: K, side?: SideId) =>
  events.filter((e) => e.kind === kind && (!side || e.side === side)) as (Logged & { kind: K })[];
const shots = (events: Logged[], side?: SideId) => of(events, 'shot', side);

describe('line of sight', () => {
  // nato id 0 at the origin facing east, pact id 1 100 m east facing west
  const faceOff = { 0: { x: 0, y: 0 }, 1: { x: 100, y: 0 } };

  it('Soldiers who see each other in range trade fire', () => {
    const { events } = play(scene({ place: faceOff }), 2 * HZ);
    expect(shots(events, 'nato').length).toBeGreaterThan(0);
    expect(shots(events, 'pact').length).toBeGreaterThan(0);
  });

  it('a wall between them blocks sight and fire', () => {
    const { events } = play(scene({ place: faceOff, map: { walls: [{ x0: 50, y0: -5, x1: 51, y1: 5 }] } }), 30 * HZ);
    expect(shots(events)).toEqual([]);
  });

  it('vision reaches 150 m: a Soldier turns to an enemy at 145 m but not at 155 m', () => {
    const facing = (gap: number) => {
      // nato faces north, the enemy is due east: inside the cone
      const { views } = play(scene({ place: { 0: { x: 0, y: 0, fx: 0, fy: 1 }, 1: { x: gap, y: 0 } } }), 1);
      const me = views[0]!.friendlies.find((f) => f.id === 0)!;
      return [me.fx, me.fy];
    };
    expect(facing(145)).toEqual([1, 0]);
    expect(facing(155)).toEqual([0, 1]);
  });

  it('fire reaches 140 m: no shots at 145 m, shots at 135 m', () => {
    const fired = (gap: number) => shots(play(scene({ place: { 0: { x: 0, y: 0 }, 1: { x: gap, y: 0 } } }), 10 * HZ).events).length;
    expect(fired(145)).toBe(0);
    expect(fired(135)).toBeGreaterThan(0);
  });

  it('a Soldier does not see an enemy behind it', () => {
    // both face east; pact is 100 m behind nato
    const { events } = play(scene({ place: { 0: { x: 0, y: 0 }, 1: { x: -100, y: 0, fx: 1 } }, tune: { hp: 1e9 } }), 10 * HZ);
    expect(shots(events, 'pact').length).toBeGreaterThan(0);
    expect(shots(events, 'nato')).toEqual([]);
  });
});

describe('fire', () => {
  // A long duel nobody can lose: 100 m apart, hit points and ammo out of reach.
  const duel = (tune: Partial<Tune> = {}, map: Partial<MapData> = {}) =>
    play(scene({ place: { 0: { x: 0, y: 0 }, 1: { x: 100, y: 0 } }, tune: { hp: 1e9, ammo: 1e6, ...tune }, map }), 120 * HZ);
  const hitRate = (events: Logged[], side?: SideId) => {
    const fired = shots(events, side);
    return fired.filter((s) => s.hit).length / fired.length;
  };

  it('hits with the base chance of 0.22 when nobody is suppressed', () => {
    const { events } = duel({ suppressAccuracyLoss: 0 });
    expect(shots(events).length).toBeGreaterThan(500);
    expect(hitRate(events)).toBeCloseTo(0.22, 1);
  });

  it('fire suppresses its target, and suppression spoils aim', () => {
    const { events, views } = duel();
    expect(views.slice(HZ).every((v) => v.friendlies[0]!.suppressed)).toBe(true);
    expect(hitRate(events)).toBeLessThan(0.17);
  });

  it('a target standing in cover is harder to hit', () => {
    const { events } = duel({ suppressAccuracyLoss: 0, coverHitMul: 0.5 }, { cover: [{ x0: 98, y0: -2, x1: 102, y1: 2 }] });
    expect(hitRate(events, 'nato')).toBeCloseTo(0.11, 1);
    expect(hitRate(events, 'pact')).toBeCloseTo(0.22, 1);
  });

  it('fire resolves simultaneously: two one-shot Soldiers who fire on the same tick are both Wounded', () => {
    const { events } = play(scene({ place: { 0: { x: 0, y: 0 }, 1: { x: 100, y: 0 } }, tune: ONE_SHOT }), 1);
    expect(events.filter((e) => e.kind === 'wounded').map((e) => e.side).sort()).toEqual(['nato', 'pact']);
  });
});

describe('taking fire', () => {
  const faceOff = { 0: { x: 0, y: 0 }, 1: { x: 100, y: 0 } };
  const taking = (views: CommanderView[]) => views.map((v) => v.squads[0]!.takingFire);

  it('a Squad shot at is taking fire for takingFireSeconds, then not', () => {
    // one-shot Soldiers Wound each other on tick 0 and nobody fires again
    const { views } = play(scene({ place: faceOff, tune: ONE_SHOT }), 6 * HZ);
    const secs = DEFAULT_TUNE.takingFireSeconds;
    expect(taking(views).slice(0, secs * HZ)).toEqual(Array(secs * HZ).fill(true));
    expect(taking(views).slice(secs * HZ + 1).some(Boolean)).toBe(false);
  });

  it('a Squad nobody shoots at is not taking fire', () => {
    expect(taking(play(scene({ place: { 0: { x: 0, y: 0 }, 1: { x: 0, y: 500 } } }), 3 * HZ).views).some(Boolean)).toBe(false);
  });
});

describe('casualties', () => {

  // nato id 0 at the origin facing west and pact id 2 100 m west facing east shoot each other on tick 0.
  // nato id 1 is id 0's squad mate, wherever the test puts it, facing east: it never sees the enemy.
  const exchange = (mate: Placement, extra: { place?: Record<number, Placement>; tune?: Partial<Tune>; map?: Partial<MapData> } = {}) =>
    scene({
      place: { 0: { x: 0, y: 0, fx: -1 }, 1: mate, 2: { x: -100, y: 0, fx: 1 }, ...extra.place },
      tune: { ...ONE_SHOT, squadSize: 2, ...extra.tune },
      map: extra.map,
    });

  it('a Wounded Soldier with nobody to revive them bleeds out after 8 s', () => {
    const { events, views } = play(exchange({ x: 0, y: 300 }), 10 * HZ);
    expect(of(events, 'wounded').map((e) => e.tick)).toEqual([0, 0]);
    expect(of(events, 'death').map((e) => e.tick / HZ)).toEqual([8, 8]);
    expect(views[0]!.friendlies.find((f) => f.id === 0)!.state).toBe('wounded');
    expect(views.at(-1)!.friendlies.find((f) => f.id === 0)).toBeUndefined();
  });

  it('each death costs 1 Ticket; a Wounding costs nothing', () => {
    const { events, views } = play(exchange({ x: 0, y: 300 }), 10 * HZ);
    const deathTick = of(events, 'death')[0]!.tick;
    expect(views[deathTick - 1]!.tickets).toEqual({ nato: 150, pact: 150 });
    expect(views[deathTick]!.tickets).toEqual({ nato: 149, pact: 149 });
  });

  it('a squad mate beside them revives them in 3 s, and nothing is lost', () => {
    const { events, views } = play(exchange({ x: 1, y: 0 }), 12 * HZ);
    expect(of(events, 'revived', 'nato').map((e) => e.tick / HZ)).toEqual([3]);
    expect(of(events, 'death', 'nato')).toEqual([]);
    expect(views.at(-1)!.tickets.nato).toBe(150);
    expect(views.at(-1)!.friendlies.find((f) => f.id === 0)!.state).toBe('alive');
  });

  it('a squad mate within 40 m runs over and revives them; one further away does not', () => {
    const revived = play(exchange({ x: 0, y: 35 }), 20 * HZ).events;
    expect(of(revived, 'revived', 'nato')).toHaveLength(1);
    expect(of(revived, 'revived', 'nato')[0]!.tick / HZ).toBeGreaterThan(3 + 30 / DEFAULT_TUNE.walkSpeed);
    expect(of(revived, 'death', 'nato')).toEqual([]);

    const lost = play(exchange({ x: 0, y: 45 }), 20 * HZ).events;
    expect(of(lost, 'revived', 'nato')).toEqual([]);
    expect(of(lost, 'death', 'nato').map((e) => e.tick / HZ)).toEqual([8]);
  });

  it('the bleed-out clock keeps running while the squad mate runs over', () => {
    // 45 m at 5.06 m/s is under 1.8 m away only after about 8.5 s
    const { events } = play(exchange({ x: 0, y: 45 }), 20 * HZ);
    expect(of(events, 'revived', 'nato')).toEqual([]);
    expect(of(events, 'death', 'nato').map((e) => e.tick / HZ)).toEqual([8]);
  });

  it('the nearest unpinned squad mate is the one who revives', () => {
    // Squads of 3: nato id 0 and pact id 3 shoot each other; mates id 1 (20 m) and id 2 (10 m) never see the enemy
    const m = scene({
      place: { 0: { x: 0, y: 0, fx: -1 }, 1: { x: 0, y: 20 }, 2: { x: 0, y: -10 }, 3: { x: -100, y: 0, fx: 1 } },
      tune: { ...ONE_SHOT, squadSize: 3 },
    });
    expect(of(play(m, 10 * HZ).events, 'revived', 'nato')).toMatchObject([{ id: 0, by: 2 }]);
  });

  it('a pinned squad mate does not revive', () => {
    // Two Squads a Side. Like `exchange`, plus pact id 6 (another Squad) behind the mate, keeping it pinned
    // in cover where it can't be hit; every enemy is behind the mate, so it never turns to fight.
    const m = scene({
      place: { 0: { x: 0, y: 0, fx: -1 }, 1: { x: 0, y: 20 }, 4: { x: -100, y: 0, fx: 1 }, 6: { x: -100, y: 20, fx: 1 } },
      tune: { ...ONE_SHOT, squadSize: 2, suppressPerShot: 1, coverHitMul: 0 },
      map: { cover: [{ x0: -2, y0: 18, x1: 2, y1: 22 }] },
      squads: 2,
    });
    const { events, views } = play(m, 10 * HZ);
    expect(views.every((v) => v.friendlies.find((f) => f.id === 1)!.suppressed)).toBe(true);
    expect(of(events, 'revived')).toEqual([]);
    expect(of(events, 'death', 'nato').map((e) => e.tick / HZ)).toEqual([8]);
  });
});

describe('Squad Respawn', () => {

  // Two Squads of 2 a Side. nato id 0 (facing west) and pact id 4 shoot each other dead on tick 0 (no revives, instant
  // bleed-out). nato id 1, 3 m north of id 0 and facing east, never sees pact id 4. `extra` adds pact id 6 (another Squad).
  const aftermath = (extra: Record<number, Placement> = {}, tune: Partial<Tune> = {}, map: Partial<MapData> = {}) =>
    play(
      scene({
        place: { 0: { x: 0, y: 0, fx: -1 }, 1: { x: 0, y: 3 }, 4: { x: -100, y: 0, fx: 1 }, ...extra },
        tune: { ...ONE_SHOT, squadSize: 2, reviveRangeM: 0, bleedOutSeconds: 1 / HZ, ...tune },
        map,
        squads: 2,
      }),
      60 * HZ,
    );

  it('a dead Soldier returns next to their living Squad 10 s after dying', () => {
    const { events } = aftermath();
    const death = of(events, 'death', 'nato')[0]!;
    const back = of(events, 'respawn', 'nato');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: 0 });
    expect((back[0]!.tick - death.tick) / HZ).toBe(10);
    expect(Math.hypot(back[0]!.x - 0, back[0]!.y - 3)).toBeLessThan(6); // next to id 1
  });

  it('waits until 5 s after the Squad last saw an enemy', () => {
    // with a respawn time of one tick, the only wait left is the quiet window: id 0 last saw pact id 4 on tick 0
    const { events } = aftermath({}, { respawnSeconds: 1 / HZ });
    expect(of(events, 'respawn', 'nato').map((e) => e.tick / HZ)).toEqual([5]);
  });

  it('is blocked while the Squad sees an enemy', () => {
    // pact id 6 stands 145 m in front of nato id 1: seen, but out of fire range
    expect(of(aftermath({ 6: { x: 145, y: 3 } }).events, 'respawn', 'nato')).toEqual([]);
    expect(of(aftermath({ 6: { x: 155, y: 3 } }).events, 'respawn', 'nato')).toHaveLength(1); // out of sight
  });

  it('is blocked while a living member is suppressed', () => {
    // pact id 6, behind nato id 1, keeps it suppressed in cover where it can't be hit, and is never seen. It stands clear
    // of where pact id 4 was last seen, out of the way of nato id 1's suppressive fire at that spot.
    const { events, views } = aftermath({ 6: { x: -100, y: 12, fx: 1 } }, { coverHitMul: 0 }, { cover: [{ x0: -2, y0: 2, x1: 2, y1: 4 }] });
    expect(views.slice(HZ).every((v) => v.friendlies.find((f) => f.id === 1)!.suppressed)).toBe(true);
    expect(of(events, 'respawn', 'nato')).toEqual([]);
  });

  it("the Commander sees each friendly Squad's strength and its respawn timers, and no enemy Squad", () => {
    const { events, views } = aftermath();
    const death = of(events, 'death', 'nato')[0]!.tick;
    const alpha = (tick: number) => views[tick]!.squads[0]!;
    expect(views[0]!.squads.map((q) => [q.name, q.size])).toEqual([['Alpha', 2], ['Bravo', 2]]);
    expect(alpha(0)).toMatchObject({ strength: 1, respawnIn: [], redeployIn: null }); // id 0 Wounded
    expect(alpha(death)).toMatchObject({ strength: 1, respawnIn: [10] });
    expect(alpha(death + 4 * HZ).respawnIn).toEqual([6]);
    expect(alpha(death + 10 * HZ)).toMatchObject({ strength: 2, respawnIn: [] });
  });

  it('a respawn timer that ran out while the Squad is not quiet reads 0', () => {
    const { views } = aftermath({ 6: { x: 145, y: 3 } });
    expect(views.at(-1)!.squads[0]).toMatchObject({ strength: 1, respawnIn: [0] });
  });
});

describe('Redeploy', () => {
  // Two Squads of 1 a Side. nato id 0 and pact id 2 shoot each other on tick 0 and bleed out at 8 s: both Squads
  // are wiped. Capture Point P, 300 m north, is nato's and can't change hands; the other Squads walk to it from their HQs.
  const P = { id: 'P', name: 'P', x: 0, y: 300, owner: 'nato' as const };
  const wipe = (extra: Record<number, Placement> = {}) =>
    of(play(
      scene({
        place: { 0: { x: 0, y: 0, fx: -1 }, 2: { x: -100, y: 0, fx: 1 }, ...extra },
        tune: { ...ONE_SHOT, captureSeconds: 1e6 },
        map: { points: [P] },
        squads: 2,
      }),
      40 * HZ,
    ).events, 'redeploy');

  it('a wiped Squad comes back whole 20 s after its last member died, at an owned, uncontested Capture Point', () => {
    const nato = wipe().find((e) => e.side === 'nato')!;
    expect(nato).toMatchObject({ squad: 0, x: 0, y: 300 });
    expect(nato.tick / HZ).toBe(28);
  });

  it('at its HQ when its Side owns no Capture Point', () => {
    expect(wipe().find((e) => e.side === 'pact')).toMatchObject({ x: 560, y: 0, tick: 28 * HZ });
  });

  it('at its HQ when the owned point is contested', () => {
    expect(wipe({ 3: { x: 0, y: 300 } }).find((e) => e.side === 'nato')).toMatchObject({ x: -560, y: 0 });
  });

  it("the Commander sees a wiped Squad's redeploy countdown", () => {
    const m = scene({
      place: { 0: { x: 0, y: 0, fx: -1 }, 2: { x: -100, y: 0, fx: 1 } },
      tune: ONE_SHOT,
      squads: 2,
    });
    const { views } = play(m, 40 * HZ);
    const alpha = (s: number) => views[s * HZ]!.squads[0]!;
    expect(alpha(8)).toMatchObject({ strength: 0, respawnIn: [], redeployIn: 20 });
    expect(alpha(20).redeployIn).toBe(8);
    expect(alpha(28)).toMatchObject({ strength: 1, redeployIn: null });
  });
});

describe('bounds', () => {
  it('Soldiers never leave the Play Area', () => {
    // a point on the north edge, Soldiers aiming up to 40 m around it; nobody sees anybody
    const m = scene({ place: {}, tune: { squadSize: 4, spread: 40, visionM: 0 }, map: { points: [{ id: 'N', name: 'N', x: 0, y: 590 }] } });
    const views: CommanderView[] = [];
    for (let i = 0; i < 200 * HZ; i++) {
      step(m, []);
      views.push(commanderView(m, 'nato'), commanderView(m, 'pact')); // both Sides' own Soldiers: no fog in the way
    }
    const reached = views.at(-2)!.friendlies.filter((f) => f.y > 560);
    expect(reached.length).toBeGreaterThan(0);
    for (const v of views) for (const f of v.friendlies) expect(f.y).toBeLessThanOrEqual(600);
  });

  it('the enemy never enters or targets the other HQ', () => {
    // nato Squad holds a point on its own HQ; the pact Squad walks at it from 200 m; nobody can be Wounded
    const hqs = { nato: { x: -100, y: 0 }, pact: { x: 100, y: 0 } };
    const m = scene({ place: {}, tune: { squadSize: 4, spread: 6, hp: 1e9 }, map: { hqs, points: [{ id: 'H', name: 'H', x: -100, y: 0, owner: 'nato' }] } });
    const { events, views } = play(m, 120 * HZ, 'pact'); // the pact's own Soldiers: no fog in the way
    const gap = Math.min(...views.flatMap((v) => v.friendlies.map((c) => Math.hypot(c.x - hqs.nato.x, c.y - hqs.nato.y))));
    expect(gap).toBeGreaterThanOrEqual(DEFAULT_TUNE.hqRadius);
    expect(gap).toBeLessThan(DEFAULT_TUNE.hqRadius + 3); // they did walk right up to it
    expect(shots(events, 'nato').length).toBeGreaterThan(0);
    expect(shots(events, 'pact')).toEqual([]);
  });
});
