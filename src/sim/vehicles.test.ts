import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, CommanderView, MapData, SideId, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks; each tank waits on its HQ (no slot given, the ground is open). */
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

/**
 * Soldier ids run nato first, squad by squad, `squadSize` each; the nato tank's id follows the last Soldier, the pact tank's
 * that. Placing Soldiers (and a tank's hit points) stands in for a map script; everything after it runs through `step`.
 */
function scene(o: { map?: Partial<MapData>; tune?: Partial<Tune>; place?: Record<number, { x: number; y: number; fx?: number; fy?: number }>; squads?: number }): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 2, speedJitter: 0, spread: 0, strayChance: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], ...o.tune };
  const m = createMatch({ seed: 1, map: field(o.map), tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(o.place ?? {})) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

type Logged = SimEvent & { tick: number };

function play(m: Match, ticks: number, side: SideId = 'nato', commands: (m: Match) => Command[] = () => []) {
  const events: Logged[] = [];
  const views: CommanderView[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    for (const e of step(m, commands(m))) events.push({ ...e, tick });
    views.push(commanderView(m, side));
  }
  return { events, views };
}

const tankOf = (v: CommanderView) => v.vehicles!.find((x) => x.side === v.side && !x.wreck)!;

/** Puts nato's tank at `at` with Soldiers `ids` aboard, driver first: a map script's crewed tank. */
function crewed(m: Match, ids: number[], at = { x: m.vehicles[0]!.x, y: m.vehicles[0]!.y }) {
  const v = m.vehicles[0]!;
  Object.assign(v, at);
  ids.forEach((id, seat) => {
    v.seats[seat] = id;
    Object.assign(m.soldiers[id]!, { ...at, vehicle: v.id });
  });
}

describe('#107 boarding: a Squad at its HQ takes the tank to a far Capture Point', () => {
  // A pact-owned point 360 m out from the nato HQ, two pact Soldiers holding it
  const enemyPoint = { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' as const }] };

  it('both Soldiers board (the first drives), it drives to the point and parks inside it, and they count for the capture', () => {
    const m = scene({ map: enemyPoint, tune: { visionM: 0 } });
    const { views } = play(m, 150 * HZ);
    const first = views[0]!;
    expect(tankOf(first).seats).toEqual([0, 1]);
    expect(first.friendlies.map((f) => f.vehicle)).toEqual([4, 4]);
    const there = views.findIndex((v) => Math.hypot(tankOf(v).x + 200, tankOf(v).y) < 25);
    expect(there).toBeGreaterThan(0);
    expect(views.at(-1)!.points[0]!.owner).toBe('nato');
    expect(Math.hypot(tankOf(views.at(-1)!).x + 200, tankOf(views.at(-1)!).y)).toBeLessThan(25);
    expect(tankOf(views.at(-1)!).seats).toEqual([0, 1]); // tank crews stay aboard at the goal and fight from it
  });

  it('nobody boards for a goal closer than boardMinM, nor a tank farther than boardM', () => {
    const near = scene({ map: { points: [{ id: 'A', name: 'A', x: -440, y: 0 }] }, tune: { visionM: 0 } });
    expect(tankOf(play(near, 2 * HZ).views.at(-1)!).seats).toEqual([-1, -1]);
    const away = scene({ map: enemyPoint, tune: { visionM: 0 }, place: { 0: { x: -500, y: 0 }, 1: { x: -500, y: 0 } } });
    expect(tankOf(play(away, 2 * HZ).views.at(-1)!).seats).toEqual([-1, -1]);
  });

  it('a lone driver waits boardWaitSeconds for others before it leaves', () => {
    const m = scene({ map: enemyPoint, tune: { visionM: 0, squadSize: 1 } });
    const { views } = play(m, 12 * HZ);
    const moved = views.findIndex((v) => tankOf(v).x > -559);
    expect(tankOf(views[0]!).seats).toEqual([0, -1]);
    expect(moved / HZ).toBeGreaterThanOrEqual(DEFAULT_TUNE.boardWaitSeconds - 0.1);
    expect(moved / HZ).toBeLessThan(DEFAULT_TUNE.boardWaitSeconds + 1.1);
  });
});

describe('#107 the kill table', () => {
  // The nato tank heads for the pact point; the pact Launcher (Soldier 3, roster member 1) waits beside its route with
  // three rockets. The tank's own guns are silent, so only the infantry acts.
  const ambush = () =>
    scene({
      map: { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' }] },
      tune: { rockets: 3, tankRangeM: 0, coaxRangeM: 0, walkSpeed: 0 },
      place: { 2: { x: -330, y: 30, fx: -1 }, 3: { x: -330, y: 30, fx: -1 } },
    });

  it('three rockets kill a tank and rifles never touch it; the crew bail under a third of its hit points; a fresh tank stands in the slot 60 s later and the Wreck stays', () => {
    const m = ambush();
    const { events, views } = play(m, 140 * HZ);
    const rockets = events.filter((e) => e.kind === 'shot' && e.to === 4);
    expect(rockets.map((e) => (e as { from: number }).from)).toEqual([3, 3, 3]);
    expect(events.some((e) => e.kind === 'shot' && e.to === 4 && e.from !== 3)).toBe(false);
    const hp = views.map((v) => v.vehicles!.find((x) => x.id === 4)?.hp).filter((h) => h !== undefined);
    expect(hp.filter((h, i) => h !== hp[i - 1])).toEqual([1, 0.65, 0.3, 1]); // the last: the fresh tank
    const bailed = views.findIndex((v) => v.friendlies.every((f) => f.vehicle === undefined));
    expect(bailed).toBeGreaterThan(rockets[1]!.tick);
    expect(bailed).toBeLessThan(rockets[2]!.tick);
    const dead = rockets[2]!.tick;
    expect(views[dead]!.vehicles!.some((x) => x.id === 4)).toBe(false);
    const fresh = views.findIndex((v, i) => i > dead && v.vehicles!.some((x) => x.id === 4));
    expect((fresh - dead) / HZ).toBeCloseTo(60, 0);
    const back = views[fresh]!;
    expect(tankOf(back)).toMatchObject({ x: -560, y: 0, hp: 1 });
    const wreck = back.vehicles!.find((x) => x.wreck)!;
    expect(Math.hypot(wreck.x + 330, wreck.y - 30)).toBeLessThan(DEFAULT_TUNE.rocketRangeM);
    expect(views.at(-1)!.vehicles!.filter((x) => x.wreck)).toHaveLength(1);
  });

  it('a Launcher carries rockets (two by default) and the riflemen fire none', () => {
    const m = scene({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' }] }, tune: { tankRangeM: 0, coaxRangeM: 0, walkSpeed: 0 }, place: { 2: { x: -330, y: 30 }, 3: { x: -330, y: 30 } } });
    const { events, views } = play(m, 60 * HZ);
    expect(events.filter((e) => e.kind === 'shot' && e.to === 4)).toHaveLength(2);
    expect(views.at(-1)!.vehicles!.find((x) => x.id === 4)!.hp).toBeCloseTo(0.3);
  });

  it('a Barrage shell on the hull costs 35; a Cruise Missile destroys it, the crew die (a Ticket each) and the caller scores them at the shell tariff', () => {
    const shell = scene({ tune: { visionM: 0, barrageCooldownSeconds: 0, barrageShells: 1, barrageSpreadM: 0 } });
    crewed(shell, [0, 1], { x: 0, y: 0 });
    play(shell, 20 * HZ, 'nato', (m) => (m.tick === 0 ? [{ tick: 0, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: 0, y: 0 } }] : []));
    expect(shell.vehicles[0]!.hp).toBe(65);
    expect(shell.soldiers[0]!.state).toBe('alive'); // inside the blast, but aboard

    const missile = scene({ tune: { visionM: 0, missileCooldownSeconds: 0, missileGated: false } });
    crewed(missile, [0, 1], { x: 0, y: 0 });
    const { events } = play(missile, 30 * HZ, 'pact', (m) => (m.tick === 0 ? [{ tick: 0, side: 'pact', kind: 'asset', asset: 'missile', at: { x: 0, y: 0 } }] : []));
    expect(events.filter((e) => e.kind === 'death').map((e) => (e as { id: number }).id).sort()).toEqual([0, 1]);
    expect(events.filter((e) => e.kind === 'award' && e.side === 'pact')).toEqual([
      expect.objectContaining({ category: 'artillery', points: DEFAULT_TUNE.scoreArtilleryKill }),
      expect.objectContaining({ category: 'artillery', points: DEFAULT_TUNE.scoreArtilleryKill }),
    ]);
    expect(missile.vehicles[0]!.deadAt).toBeGreaterThan(0);
    expect(missile.tickets.nato).toBe(DEFAULT_TUNE.tickets - 2); // one Ticket each
  });

  it('the crew get out under a third of its hit points, and the abandoned tank stays where it stopped', () => {
    const m = scene({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' }] }, tune: { visionM: 0, walkSpeed: 0 } });
    play(m, 10 * HZ);
    m.vehicles[0]!.hp = 30;
    const { views } = play(m, 30 * HZ);
    const v = views.at(-1)!;
    expect(tankOf(v).seats).toEqual([-1, -1]);
    expect(v.friendlies.every((f) => f.vehicle === undefined)).toBe(true);
    expect(tankOf(views[2 * HZ]!)).toMatchObject({ x: tankOf(v).x, y: tankOf(v).y });
  });
});

describe('#107 the tank fights', () => {
  it('its main gun fires every tankFireSeconds, a round flying at tankShellMps to a Strike-shaped impact; the coax fires at infantry; nobody aboard is shot', () => {
    // the crewed nato tank on its HQ facing east, pact Soldiers 120 m and 156 m off in the open
    const m = scene({ tune: { hp: 1e9 }, place: { 2: { x: -440, y: 0, fx: -1 }, 3: { x: -440, y: 100, fx: -1 } } });
    crewed(m, [0, 1]);
    const { events } = play(m, 13 * HZ);
    const impacts = events.filter((e) => e.kind === 'impact');
    expect(impacts.map((e) => [e.x, e.y])).toEqual([[-440, 0], [-440, 100]]);
    expect(impacts[0]).toMatchObject({ side: 'nato', asset: 'tank', from: 4 });
    const flight = (d: number) => d / DEFAULT_TUNE.tankShellMps;
    expect(impacts[0]!.tick / HZ).toBeCloseTo(flight(120), 1);
    expect((impacts[1]!.tick - impacts[0]!.tick) / HZ).toBeCloseTo(DEFAULT_TUNE.tankFireSeconds + flight(Math.hypot(120, 100)) - flight(120), 1);
    expect(events.filter((e) => e.kind === 'death').map((e) => (e as { id: number }).id)).toEqual([2, 3]); // inside the kill radius
    expect(events.some((e) => e.kind === 'shot' && e.from === 1 && e.to === 2)).toBe(true); // the coax
    expect(events.some((e) => e.kind === 'shot' && (e.to === 0 || e.to === 1))).toBe(false);
  });

  it('the main gun takes an enemy tank before infantry, for tankVsVehicleDamage', () => {
    const m = scene({ tune: { visionM: 0 }, place: { 2: { x: -440, y: 0 }, 3: { x: -440, y: 0 } } });
    crewed(m, [0, 1]);
    Object.assign(m.vehicles[1]!, { x: -400, y: 0 });
    m.tune.visionM = DEFAULT_TUNE.visionM;
    const { events, views } = play(m, 2 * HZ); // 160 m of flight
    expect(views[0]!.vehicles!.find((x) => x.id === 4)!.rounds).toEqual([{ from: { x: -560, y: 0 }, to: { x: -400, y: 0 }, flight: expect.any(Number) }]);
    expect(events.find((e) => e.kind === 'impact')).toMatchObject({ x: -400, y: 0 });
    expect(m.vehicles[1]!.hp).toBe(DEFAULT_TUNE.tankHp - DEFAULT_TUNE.tankVsVehicleDamage);
  });

  it('a dead member Squad Respawns into a free seat of the Squad Leader\'s tank', () => {
    const m = scene({ tune: { squadSize: 3, visionM: 0 } });
    crewed(m, [0]);
    Object.assign(m.soldiers[1]!, { state: 'dead', deadAt: 0 });
    play(m, (DEFAULT_TUNE.respawnSeconds + 1) * HZ);
    expect(m.vehicles[0]!.seats).toEqual([0, 1]);
    expect(m.soldiers[1]!.vehicle).toBe(6);
  });

  it('a dead member with its leader on foot comes back as the driver of an idle tank, and a wiped Squad Redeploys into one', () => {
    const m = scene({ tune: { squadSize: 3, visionM: 0 } });
    for (const id of [0, 1, 2]) Object.assign(m.soldiers[id]!, { x: -100, y: 0 });
    Object.assign(m.soldiers[1]!, { state: 'dead', deadAt: 0 });
    const v0 = play(m, (DEFAULT_TUNE.respawnSeconds + 1) * HZ).views.at(-1)!;
    expect(tankOf(v0).seats).toEqual([1, -1]);
    expect(v0.friendlies.find((f) => f.id === 1)).toMatchObject({ vehicle: 6, x: -560, y: 0 });

    const wiped = scene({ tune: { squadSize: 3, visionM: 0 } });
    for (const id of [0, 1, 2]) Object.assign(wiped.soldiers[id]!, { x: -100, y: 0, state: 'dead', deadAt: 0 });
    const v1 = play(wiped, (DEFAULT_TUNE.redeploySeconds + 1) * HZ).views.at(-1)!;
    expect(tankOf(v1).seats).toEqual([0, 1]); // the first two take it; the third Redeploys on foot
    expect(v1.friendlies.find((f) => f.id === 2)!.vehicle).toBeUndefined();
  });

  it('shows a tank with nobody aboard as empty', () => {
    const m = scene({ tune: { visionM: 0 }, place: { 0: { x: 0, y: 0 }, 1: { x: 0, y: 0 } } });
    const v = play(m, 1).views[0]!;
    expect(tankOf(v).empty).toBe(true);
    crewed(m, [0]);
    expect(tankOf(play(m, 1).views[0]!).empty).toBeUndefined();
  });

  it('takes `tanksPerSide` slots in each HQ, each further one 9 m toward the field, ids after the Soldiers', () => {
    const m = scene({ tune: { tanksPerSide: 3 } });
    expect(m.vehicles.map((v) => [v.id, v.side, v.slot.x])).toEqual([
      [4, 'nato', -560], [5, 'nato', -551], [6, 'nato', -542],
      [7, 'pact', 560], [8, 'pact', 551], [9, 'pact', 542],
    ]);
  });

  it('hashes every vehicle field, every Wreck and who rides where', () => {
    const m = scene({});
    const moves = (change: (m: Match) => void) => {
      const h = stateHash(m);
      change(m);
      expect(stateHash(m)).not.toBe(h);
    };
    moves((m) => (m.vehicles[0]!.x += 1));
    moves((m) => (m.vehicles[0]!.hp -= 35));
    moves((m) => (m.vehicles[0]!.seats[0] = 0));
    moves((m) => (m.soldiers[0]!.vehicle = 4));
    moves((m) => (m.soldiers[1]!.rockets -= 1));
    moves((m) => (m.vehicles[1]!.target = 0));
    moves((m) => m.wrecks.push({ side: 'nato', kind: 'tank', x: 1, y: 2, fx: 1, fy: 0, seen: false }));
  });

  it('replays hash the same, tanks and all', () => {
    const run = () => {
      const m = createMatch({ seed: 9, map: field({ points: [{ id: 'A', name: 'A', x: 0, y: 200 }, { id: 'B', name: 'B', x: 0, y: -200 }] }), tune: DEFAULT_TUNE, squadsPerSide: 3, commanderSide: 'nato' });
      for (let i = 0; i < 90 * HZ; i++) step(m, []);
      return { hash: stateHash(m), moved: m.vehicles.map((v) => v.x) };
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a.moved).not.toEqual([-560, 560]);
  });
});
