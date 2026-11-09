import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { dogleg } from './flight';
import { insidePolygon } from './geometry';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
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
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 2, speedJitter: 0, spread: 0, strayChance: 0, drainSeconds: [1e9, 1e9, 1e9, 1e9, 1e9], jeepsPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, pointJeeps: false, ...NO_TRAITS, ...NO_TEMPO, ...o.tune };
  const m = thinkOnId(createMatch({ seed: 1, map: field(o.map), tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' }));
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
      tune: { rockets: 3, tankRangeM: 0, coaxRangeM: 0, walkSpeed: 0, hp: 1e9 }, // nobody is Wounded in the firefight once the crew bail
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
    const m = scene({ tune: { hp: 1e9, tankAimSeconds: [0, 0] }, place: { 2: { x: -440, y: 0, fx: -1 }, 3: { x: -440, y: 100, fx: -1 } } });
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

  it('the main gun fires on a new target only after a seeded aim time of tankAimSeconds', () => {
    const firsts = [1, 2, 3, 4].map((seed) => {
      const m = createMatch({ seed, map: field(), tune: { ...DEFAULT_TUNE, ...NO_TRAITS, ...NO_TEMPO, squadSize: 2, spread: 0, speedJitter: 0 }, squadsPerSide: 1, commanderSide: 'nato' });
      Object.assign(m.soldiers[2]!, { x: -500, y: 0 });
      Object.assign(m.soldiers[3]!, { x: -500, y: 0 });
      crewed(m, [0, 1]);
      let fired = -1;
      for (let i = 0; i < 5 * HZ && fired < 0; i++) if (step(m, []).length && m.vehicles[0]!.rounds.length) fired = m.tick - 1;
      return fired / HZ;
    });
    for (const f of firsts) expect(f).toBeGreaterThanOrEqual(DEFAULT_TUNE.tankAimSeconds[0]), expect(f).toBeLessThanOrEqual(DEFAULT_TUNE.tankAimSeconds[1] + 1 / HZ); // the round shows a tick after the aim ends
    expect(new Set(firsts).size).toBeGreaterThan(1);
  });

  it('the main gun takes an enemy tank before infantry, for tankVsVehicleDamage', () => {
    const m = scene({ tune: { visionM: 0, tankAimSeconds: [0, 0] }, place: { 2: { x: -440, y: 0 }, 3: { x: -440, y: 0 } } });
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
    // #131 helicopter jobs
    moves((m) => (m.vehicles[0]!.job = 'support'));
    moves((m) => (m.vehicles[0]!.fetch = 3));
    moves((m) => (m.vehicles[0]!.spot = { x: 1, y: 2 }));
    moves((m) => (m.vehicles[0]!.spin = -1));
    moves((m) => (m.vehicles[0]!.until = 99));
    moves((m) => (m.vehicles[0]!.drop = true));
    moves((m) => (m.vehicles[0]!.crashAt = 99));
    // #129 crew and #130 parachute, per Soldier
    moves((m) => (m.soldiers[0]!.crew = true));
    moves((m) => (m.soldiers[0]!.crewUntil = 99));
    moves((m) => (m.soldiers[0]!.crewSeat = 2));
    moves((m) => (m.soldiers[0]!.chute = { t0: 1, t1: 9, x0: 0, y0: 0, x1: 5, y1: 5 }));
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

describe('#108 the jeep: a Squad rides to its Capture Point and gets out', () => {
  // No tanks: each Side's jeep waits on its HQ; with four to a Squad the nato Soldiers are 0..3, its jeep 8, the pact's 9
  const ride = (extra: Partial<Tune> = {}) => scene({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0 }] }, tune: { visionM: 0, squadSize: 4, tanksPerSide: 0, jeepsPerSide: 1, ...extra } });
  const jeepOf = (v: CommanderView) => v.vehicles!.find((x) => x.side === v.side && x.kind === 'jeep' && !x.wreck)!;

  it('the Squad fills it at match start, it reaches the point in under a minute, everyone gets out within dismountM of it after a stop, and it stays parked empty', () => {
    const m = ride();
    const { views } = play(m, 80 * HZ);
    const filled = views.findIndex((v) => jeepOf(v).seats!.every((id) => id >= 0)); // #122: they walk to it and climb in one by one
    expect(filled).toBeGreaterThan(0);
    expect(filled / HZ).toBeLessThan(4);
    expect(jeepOf(views[filled]!)).toMatchObject({ id: 8, kind: 'jeep', hp: 1 });
    const exits = [0, 1, 2, 3].map((id) => views.findIndex((v, i) => i > filled + 2 * HZ && v.friendlies.find((f) => f.id === id)!.vehicle === undefined));
    for (const [n, e] of exits.entries()) {
      expect(e / HZ).toBeLessThan(60);
      const me = views[e]!.friendlies.find((f) => f.id === n)!;
      expect(Math.hypot(me.x + 200, me.y)).toBeLessThanOrEqual(DEFAULT_TUNE.dismountM + 1);
      const at = (i: number) => jeepOf(views[i]!);
      expect(at(e - DEFAULT_TUNE.dismountStopSeconds * HZ)).toMatchObject({ x: at(e).x, y: at(e).y }); // it stood for the dismount
    }
    const last = jeepOf(views.at(-1)!);
    expect(last.seats).toEqual([-1, -1, -1, -1]);
    expect(jeepOf(views.at(-5 * HZ)!)).toMatchObject({ x: last.x, y: last.y });
  });

  it('a passenger whose own point is another gets out when the jeep drives away from it, walks there Detached and rejoins', () => {
    // Bravo's leader (Soldier 2) holds B; its Soldier 3 rides Alpha's jeep (Soldiers 0 and 1) from the HQ, bound for A past B
    const m = scene({
      map: { points: [{ id: 'A', name: 'A', x: 0, y: 0 }, { id: 'B', name: 'B', x: -200, y: 150 }] },
      tune: { visionM: 0, tanksPerSide: 0, jeepsPerSide: 1, sameWayM: 300, rockets: 0, captureSeconds: 1e4 }, // nobody fights, B stays worth going to
      squads: 2,
      place: { 2: { x: -200, y: 150 } },
    });
    const order = (point: number) => ({ point, hold: false, delayed: null, since: 0 });
    m.squads[0]!.order = order(0);
    m.squads[1]!.order = order(1);
    const jeep = m.vehicles.find((v) => v.side === 'nato')!;
    const s3 = m.soldiers[3]!;
    jeep.seats.splice(0, 3, 0, 1, 3); // a map script's ride: Bravo's Soldier 3 aboard Alpha's jeep (Squads no longer board together)
    for (const id of [0, 1, 3]) m.soldiers[id]!.vehicle = jeep.id;
    let rode = false;
    let exit: { tick: number; x: number; y: number } | null = null;
    let detached = false;
    for (let i = 0; i < 100 * HZ; i++) {
      step(m, []);
      rode ||= s3.vehicle === jeep.id;
      if (rode && !exit && s3.vehicle < 0) exit = { tick: m.tick, x: jeep.x, y: jeep.y };
      detached ||= !!exit && s3.detached;
    }
    expect(rode).toBe(true);
    expect(exit).not.toBeNull();
    expect(Math.hypot(exit!.x + 200, exit!.y - 150)).toBeGreaterThan(150 + 30); // well past B and still going
    expect(Math.hypot(exit!.x, exit!.y)).toBeGreaterThan(m.points[0]!.radius); // short of A
    expect(jeep.seats[0]).toBe(-1); // Alpha drove on to A and got out
    expect(detached).toBe(true);
    expect(s3.detached).toBe(false);
    expect(Math.hypot(s3.x + 200, s3.y - 150)).toBeLessThan(m.points[1]!.radius);
  });
});

describe('#108 the jeep fights and dies', () => {
  /** Seats Soldiers `ids` (driver first) in vehicle `v` at `at`: a map script's crew. */
  function seat(m: Match, v: number, ids: number[], at: { x: number; y: number; fx?: number; fy?: number }) {
    const j = m.vehicles.find((o) => o.id === v)!;
    Object.assign(j, at);
    ids.forEach((id, k) => {
      j.seats[k] = id;
      Object.assign(m.soldiers[id]!, { x: at.x, y: at.y, vehicle: v });
    });
  }
  const shotsBy = (events: Logged[], from: number) => events.filter((e) => e.kind === 'shot' && e.from === from) as (Logged & { to: number })[];

  it('the MG fires only with a gunner aboard, every mgFireSeconds, at infantry within mgRangeM', () => {
    // nato's jeep (4) on its HQ facing east; pact Soldier 2 150 m off, Soldier 3 at 170 m
    const crew = (ids: number[]) => {
      const m = scene({ tune: { tanksPerSide: 0, jeepsPerSide: 1, hp: 1e9, fireJitterSeconds: 0, walkSpeed: 0 }, place: { 2: { x: -410, y: 0, fx: 1 }, 3: { x: -390, y: 0, fx: 1 } } });
      seat(m, 4, ids, { x: -560, y: 0 });
      return play(m, 4 * HZ).events;
    };
    const events = crew([0, 1]);
    const mg = shotsBy(events, 1);
    expect(mg.length).toBeGreaterThan(10);
    expect(new Set(mg.map((e) => e.to))).toEqual(new Set([2]));
    expect(new Set(mg.slice(1).map((e, i) => e.tick - mg[i]!.tick))).toEqual(new Set([Math.round(DEFAULT_TUNE.mgFireSeconds * HZ)]));
    expect(shotsBy(events, 0)).toEqual([]); // the driver only drives
    expect(shotsBy(crew([0]), 0)).toEqual([]);
  });

  it('a rifle Squad shoots an empty jeep to a Wreck, hitting it like a Soldier', () => {
    const m = scene({ tune: { tanksPerSide: 0, jeepsPerSide: 1, walkSpeed: 0, rockets: 0 }, place: { 2: { x: 100, y: 0, fx: -1 }, 3: { x: 100, y: 5, fx: -1 } } });
    Object.assign(m.vehicles[0]!, { x: 0, y: 0 });
    const { events, views } = play(m, 30 * HZ, 'pact');
    const hits = events.filter((e) => e.kind === 'shot' && e.to === 4);
    expect(new Set(hits.map((e) => (e as { from: number }).from))).toEqual(new Set([2, 3]));
    expect(m.vehicles[0]!.deadAt).toBeGreaterThan(0);
    expect(views.at(-1)!.vehicles!.find((x) => x.wreck)).toMatchObject({ side: 'nato', kind: 'jeep', x: 0, y: 0 });
  });

  it('a tank round on a full jeep destroys it: four Tickets', () => {
    // nato's Squad (0..3) in its jeep (9) out in the field; pact's tank (10), crewed by 4 and 5, 150 m east facing it
    const m = scene({ tune: { squadSize: 4, tanksPerSide: 1, jeepsPerSide: 1, tankAimSeconds: [0, 0] }, place: { 6: { x: 500, y: 400 }, 7: { x: 500, y: 400 } } });
    seat(m, 9, [0, 1, 2, 3], { x: 0, y: 0 });
    seat(m, 10, [4, 5], { x: 150, y: 0, fx: -1, fy: 0 });
    const { events } = play(m, 4 * HZ);
    expect(events.filter((e) => e.kind === 'death').map((e) => (e as { id: number }).id).sort()).toEqual([0, 1, 2, 3]);
    expect(m.tickets.nato).toBe(DEFAULT_TUNE.tickets - 4);
    expect(m.vehicles.find((v) => v.id === 9)!.deadAt).toBeGreaterThan(0);
  });

  it('hashes the dismount stop, when it last moved, and each passenger\'s way out', () => {
    const m = scene({ tune: { tanksPerSide: 0, jeepsPerSide: 1 } });
    const moves = (change: (m: Match) => void) => {
      const h = stateHash(m);
      change(m);
      expect(stateHash(m)).not.toBe(h);
    };
    moves((m) => (m.vehicles[0]!.halt = 3));
    moves((m) => (m.vehicles[0]!.movedAt += 1));
    moves((m) => (m.soldiers[0]!.exited = 4));
    moves((m) => (m.soldiers[0]!.away = 120.5));
    moves((m) => (m.soldiers[0]!.awaySince = 7));
  });
});

describe('#108 a jeep at every Capture Point but the middle one, for its owner', () => {
  // A neutral, C in the middle, E pact's from the start; nato's Soldiers stand in A, pact's in C. Vehicles: A's jeep 4, E's 5
  const points = () =>
    scene({
      map: { points: [{ id: 'A', name: 'A', x: -300, y: 0 }, { id: 'C', name: 'C', x: 0, y: 0 }, { id: 'E', name: 'E', x: 300, y: 0, owner: 'pact' }] },
      tune: { tanksPerSide: 0, pointJeeps: true, visionM: 0, walkSpeed: 0, rockets: 0, boardM: 0 }, // nobody drives off in them
      place: { 0: { x: -300, y: 0 }, 1: { x: -300, y: 5 }, 2: { x: 0, y: 0 }, 3: { x: 0, y: 5 } },
    });
  const jeepAt = (v: CommanderView, p: { x: number; y: number }) => v.vehicles!.find((x) => x.kind === 'jeep' && !x.wreck && Math.hypot(x.x - p.x, x.y - p.y) < 25);

  it('one waits at a point owned from the start; one appears the moment a point is captured; never at the middle one', () => {
    const m = points();
    expect(m.vehicles.map((v) => [v.id, v.side, v.deadAt === -1])).toEqual([[4, 'nato', false], [5, 'pact', true]]);
    const { views } = play(m, 50 * HZ, 'nato');
    const pact = play(points(), 50 * HZ, 'pact').views;
    expect(jeepAt(pact[0]!, { x: 300, y: 0 })).toMatchObject({ side: 'pact', empty: true });
    const taken = views.findIndex((v) => v.points[0]!.owner === 'nato');
    expect(taken).toBeGreaterThan(0);
    expect(jeepAt(views[taken - 1]!, { x: -300, y: 0 })).toBeUndefined();
    expect(jeepAt(views[taken + 1]!, { x: -300, y: 0 })).toMatchObject({ id: 4, side: 'nato' }); // the vehicle phase of the next tick
    expect(pact.at(-1)!.points[1]!.owner).toBe('pact');
    expect(pact.some((v) => jeepAt(v, { x: 0, y: 0 }))).toBe(false);
  });

  it('a destroyed one comes back for the owner vehicleRespawnSeconds later, at the point', () => {
    const m = points();
    play(m, 40 * HZ);
    const j = m.vehicles[0]!;
    expect(j.deadAt).toBe(-1);
    Object.assign(j, { hp: 0, deadAt: m.tick, x: -250, y: 40 }); // a map script's wreck: it died off the point
    const dead = m.tick;
    const { views } = play(m, 61 * HZ);
    const back = views.findIndex((v) => jeepAt(v, { x: -300, y: 0 }));
    expect((back + 1) / HZ).toBeCloseTo(DEFAULT_TUNE.vehicleRespawnSeconds, 0);
    expect(m.tick - dead).toBeGreaterThan(back);
    expect(jeepAt(views.at(-1)!, { x: -300, y: 0 })).toMatchObject({ side: 'nato', hp: 1 });
  });
});

describe('#109 the transport helicopter ferries a Squad', () => {
  // No ground vehicles: each Side's helicopter waits on its HQ. Nato's Squad is Soldiers 0..3, its helicopter 8, the pact's 9;
  // the pact Squad stands far off its own, so only nato flies. A is far across the field.
  const A = { x: 300, y: 200 };
  const away = { x: 500, y: -500 };
  const ferry = (extra: Partial<Tune> = {}, place: Record<number, { x: number; y: number; fx?: number; fy?: number }> = {}) =>
    scene({ map: { points: [{ id: 'A', name: 'A', ...A }] }, tune: { visionM: 0, squadSize: 4, tanksPerSide: 0, helisPerSide: 1, ...extra }, place: { 4: away, 5: away, 6: away, 7: away, ...place } });
  const heliOf = (v: CommanderView) => v.vehicles!.find((x) => x.side === v.side && x.kind === 'helicopter' && !x.wreck)!;

  it('the Squad boards at match start, it flies a dogleg to the far point, lands off it, unloads, and flies home empty', () => {
    const m = ferry({ crewSeconds: [1000, 1000] });
    const { views } = play(m, 100 * HZ); // #124: braking no harder than speeding up
    const filled = views.findIndex((v) => heliOf(v).seats!.filter((id) => id >= 0).length === 4); // #129: a pilot from the Squad first, #122: the others walk to it and climb in one by one
    expect(filled).toBeGreaterThan(0);
    expect(filled / HZ).toBeLessThan(20);
    expect(heliOf(views[filled]!)).toMatchObject({ id: 8 });
    const up = views.findIndex((v) => heliOf(v).airborne);
    expect(up).toBeGreaterThanOrEqual(filled);
    const landed = views.findIndex((v, i) => i > up && !heliOf(v).airborne);
    const lz = heliOf(views[landed]!);
    const off = Math.hypot(lz.x - A.x, lz.y - A.y); // #124: a Landing Zone lzM from the point's centre
    expect(off).toBeGreaterThanOrEqual(DEFAULT_TUNE.lzM[0] - 0.01);
    expect(off).toBeLessThanOrEqual(DEFAULT_TUNE.lzM[1] + 0.01);
    expect(Math.hypot(lz.x - A.x, lz.y - A.y)).toBeGreaterThan(DEFAULT_TUNE.captureRadius); // so the passengers walk in
    const lift = views.findIndex((v, i) => i > landed && heliOf(v).airborne);
    expect((lift - landed) / HZ).toBeCloseTo(DEFAULT_TUNE.unloadSeconds + DEFAULT_TUNE.spoolSeconds, 0); // #124: unloaded, then the rotor spools up
    const pilot = heliOf(views[lift]!).seats![0]!;
    expect([1, 2, 3]).toContain(pilot); // a member of the Squad, never its leader
    expect(heliOf(views[lift]!).seats).toEqual([pilot, -1, -1, -1, -1, -1]); // the pilot stays for its stint
    const home = heliOf(views.at(-1)!);
    expect(home).toMatchObject({ x: -560, y: 0, seats: [pilot, -1, -1, -1, -1, -1] });
    expect(home.airborne).toBeUndefined();
    for (const id of [0, 1, 2, 3].filter((id) => id !== pilot)) expect(Math.hypot(m.soldiers[id]!.x - A.x, m.soldiers[id]!.y - A.y)).toBeLessThan(DEFAULT_TUNE.captureRadius + 10);
    expect(views.at(-1)!.points[0]!.owner).toBe('nato');
  });

  it('its riders never count in a Capture Point it flies over, and count in the one it lands in', () => {
    // pact's B lies on the line to A, out of boarding reach of the passengers' goal choice (A, pact's too, scores higher)
    const m = scene({
      map: { points: [{ id: 'A', name: 'A', ...A, owner: 'pact' }, { id: 'B', name: 'B', x: -130, y: 100, owner: 'pact' }] },
      tune: { visionM: 0, squadSize: 4, tanksPerSide: 0, helisPerSide: 1, doglegMinM: 1e9, lzM: [0, 0] }, // #124: straight, down on the centre
      place: { 4: away, 5: away, 6: away, 7: away },
    });
    m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
    const { views } = play(m, 60 * HZ);
    const up = views.findIndex((v) => heliOf(v).airborne);
    const landed = views.findIndex((v, i) => i > up && !heliOf(v).airborne);
    const over = views.findIndex((v) => Math.hypot(heliOf(v).x + 130, heliOf(v).y - 100) < 5);
    expect(over).toBeGreaterThan(0);
    expect(over).toBeLessThan(landed);
    expect(views.every((v) => v.points[1]!.progress === -1)).toBe(true);
    expect(views[landed - 1]!.points[0]!.progress).toBe(-1);
    expect(views[landed]!.points[0]!.progress).toBeGreaterThan(-1); // the tick it sets down, before anyone is out
  });

  it('the enemy Console never shows it while nobody of theirs sees it, in the air or on the ground', () => {
    const { views } = play(ferry(), 40 * HZ, 'pact');
    expect(views.some((v) => v.vehicles!.some((x) => x.id === 8))).toBe(false);
    expect(views.every((v) => !v.lastKnown!.length)).toBe(true);
  });

  it('a rifle Squad under its landing zone shoots it down: everyone aboard dies, a Ticket each; the Wreck lies where it fell; a fresh one stands on the helipad vehicleRespawnSeconds later', () => {
    // pact's Squad stands at A facing the way it comes; nobody is Wounded (hp), so only the helicopter dies
    const atA = (dy: number) => ({ x: A.x, y: A.y + dy, fx: -1, fy: 0 });
    const m = ferry({ visionM: DEFAULT_TUNE.visionM, walkSpeed: 0, hp: 1e9, rockets: 0, lzM: [0, 0] }, { 4: atA(-6), 5: atA(-2), 6: atA(2), 7: atA(6) });
    const aboard: number[] = [];
    let dead = -1;
    let back: { tick: number; x: number; y: number; hp: number } | null = null;
    const events: Logged[] = [];
    const views: CommanderView[] = [];
    for (let i = 0; i < 110 * HZ; i++) {
      const v = m.vehicles[0]!;
      const was = v.seats.filter((id) => id >= 0);
      const tick = m.tick;
      for (const e of step(m, [])) events.push({ ...e, tick });
      views.push(commanderView(m, 'pact'));
      if (dead < 0 && v.deadAt >= 0) [dead, aboard[0]] = [tick, was.length];
      if (dead >= 0 && !back && v.deadAt === -1) back = { tick, x: v.x, y: v.y, hp: v.hp };
    }
    expect(dead).toBeGreaterThan(0);
    expect(new Set(events.filter((e) => e.kind === 'shot' && e.to === 8 && e.hit).map((e) => (e as { from: number }).from)).size).toBeGreaterThan(1);
    const deaths = events.filter((e) => e.kind === 'death' && e.tick === dead);
    expect(deaths).toHaveLength(aboard[0]!);
    expect(m.tickets.nato).toBe(DEFAULT_TUNE.tickets - aboard[0]!);
    const wreck = views.at(-1)!.vehicles!.find((x) => x.wreck)!;
    expect(wreck).toMatchObject({ side: 'nato', kind: 'helicopter' });
    expect(Math.hypot(wreck.x - A.x, wreck.y - A.y)).toBeLessThan(DEFAULT_TUNE.fireRangeM);
    expect(back).toMatchObject({ x: -560, y: 0, hp: DEFAULT_TUNE.heliHp });
    expect((back!.tick - dead) / HZ).toBeCloseTo(DEFAULT_TUNE.vehicleRespawnSeconds, 0);
  });
});

describe('#109 where the helicopter flies', () => {
  // Two nato Squads (0..3 Ordered to A, 4..7 to B) and their helicopter 16 on the HQ; everyone not seated stands far off
  const A = { x: 300, y: 200 };
  const B = { x: 300, y: -200 };
  const away = (id: number) => (id < 8 ? { x: -300, y: 550 } : { x: 300, y: -550 }); // apart: even blind eyes see at 0 m
  function lands(seats: number[]) {
    const place = Object.fromEntries([...Array(16).keys()].filter((id) => !seats.includes(id)).map((id) => [id, away(id)]));
    const m = scene({ map: { points: [{ id: 'A', name: 'A', ...A }, { id: 'B', name: 'B', ...B }] }, tune: { visionM: 0, squadSize: 4, tanksPerSide: 0, helisPerSide: 1, lzM: [0, 0] }, squads: 2, place }); // #124: down on the centre
    m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
    m.squads[1]!.order = { point: 1, hold: false, delayed: null, since: 0 };
    const h = m.vehicles[0]!;
    seats.forEach((id, k) => (h.seats[k] = id) >= 0 && Object.assign(m.soldiers[id]!, { x: h.x, y: h.y, vehicle: h.id }));
    for (let flown = false, i = 0; i < 40 * HZ && !(flown && !h.airborne); i++) (step(m, []), (flown ||= h.airborne));
    return h;
  }

  it('to its passengers\' majority goal, the pilot\'s goal breaking a tie', () => {
    const near = (h: { x: number; y: number }, p: { x: number; y: number }) => Math.hypot(h.x - p.x, h.y - p.y) < DEFAULT_TUNE.captureRadius;
    expect(near(lands([0, 4, 5, 1]), B)).toBe(true); // two for B, one for A
    expect(near(lands([0, 4, 1, -1]), A)).toBe(true); // one each: the pilot (Alpha) is for A
    expect(near(lands([4, 0, 5, 1]), A)).toBe(true);
  });

  it('a dead member never comes back into its Squad Leader\'s helicopter while it is in the air', () => {
    const m = scene({ map: { points: [{ id: 'A', name: 'A', ...A }] }, tune: { visionM: 0, squadSize: 3, tanksPerSide: 0, helisPerSide: 1 }, place: { 2: { x: 500, y: 0 }, 3: { x: 500, y: -500 }, 4: { x: 500, y: -500 }, 5: { x: 500, y: -500 } } });
    const h = m.vehicles[0]!;
    [0, 1].forEach((id, k) => (h.seats[k] = id) >= 0 && Object.assign(m.soldiers[id]!, { x: h.x, y: h.y, vehicle: h.id }));
    Object.assign(m.soldiers[2]!, { state: 'dead', deadAt: 0 });
    for (let i = 0; i < (DEFAULT_TUNE.respawnSeconds + 1) * HZ; i++) step(m, []);
    expect(h.airborne).toBe(true); // A is over 30 s away
    expect(m.soldiers[2]!).toMatchObject({ state: 'alive', vehicle: -1 });
  });

  it('round the enemy HQ circle, never into it', () => {
    const behind = { x: 588, y: 24 }; // past the pact HQ (560, 0) from nato's
    const m = scene({ map: { points: [{ id: 'A', name: 'A', ...behind }] }, tune: { visionM: 0, squadSize: 4, tanksPerSide: 0, helisPerSide: 1, lzM: [0, 0] }, place: { 4: { x: 0, y: 550 }, 5: { x: 0, y: 550 }, 6: { x: 0, y: 550 }, 7: { x: 0, y: 550 } } });
    const h = m.vehicles[0]!;
    let closest = Infinity;
    for (let i = 0; i < 60 * HZ; i++) {
      step(m, []);
      closest = Math.min(closest, Math.hypot(h.x - 560, h.y));
    }
    expect(closest).toBeGreaterThanOrEqual(DEFAULT_TUNE.hqRadius - 1e-6);
    expect(m.soldiers.slice(1, 4).some((s) => Math.hypot(s.x - behind.x, s.y - behind.y) < 40)).toBe(true); // it got them there
  });
});

describe('#109 the helicopter\'s sight, and being seen', () => {
  // A wall north-south at x = -60; nato's helicopter (4) at the centre. Pact's Soldiers 2 and 3.
  const wall = { walls: [{ x0: -64, y0: -80, x1: -56, y1: 80 }] };
  const sky = (place: Record<number, { x: number; y: number; fx?: number; fy?: number }>, heli: { airborne: boolean; seats: number[] }, tune: Partial<Tune> = {}) => {
    const m = scene({ map: wall, tune: { tanksPerSide: 0, helisPerSide: 1, walkSpeed: 0, rockets: 0, ...tune }, place: { 0: { x: 500, y: 500 }, 1: { x: 500, y: 500 }, ...place } });
    Object.assign(m.vehicles[0]!, { x: 0, y: 0, ...heli });
    heli.seats.forEach((id) => id >= 0 && Object.assign(m.soldiers[id]!, { x: 0, y: 0, vehicle: 4 }));
    return m;
  };

  it('a crewed one sees all round over walls out to airVisionM', () => {
    // Soldier 2 behind the wall and behind its facing, 200 m off; Soldier 3 past airVisionM
    const m = sky({ 2: { x: -200, y: 0 }, 3: { x: 0, y: DEFAULT_TUNE.airVisionM + 10 } }, { airborne: false, seats: [0, -1, -1, -1] }, { visionM: 0 });
    const { views } = play(m, 1); // it faces east as it looks (it turns for home only after)
    expect(views[0]!.contacts.map((c) => c.id)).toEqual([2]);
  });

  it('a Soldier sees and shoots an airborne one over a wall, never a landed one', () => {
    const fires = (airborne: boolean) => {
      const m = sky({ 2: { x: -120, y: 0, fx: 1, fy: 0 }, 3: { x: -120, y: 4, fx: 1, fy: 0 } }, { airborne, seats: [-1, -1, -1, -1] });
      return play(m, 5 * HZ, 'pact').events.filter((e) => e.kind === 'shot' && e.to === 4).length;
    };
    expect(fires(true)).toBeGreaterThan(0);
    expect(fires(false)).toBe(0);
  });

  it('a side gun fires over walls from its seat at a target on its side; a passenger seat and the far side\'s gun never do (#129)', () => {
    const gun = (seats: number[]) => {
      const m = sky({ 2: { x: -120, y: 0 }, 3: { x: -120, y: 4 } }, { airborne: false, seats }, { hp: 1e9, visionM: 0 }); // behind the wall
      Object.assign(m.vehicles[0]!, { fx: 0, fy: 1, slot: { x: 0, y: 0 } }); // heading north, home is here: the west is its left
      return play(m, 3 * HZ).events.filter((e) => e.kind === 'shot' && e.side === 'nato').map((e) => (e as { from: number }).from);
    };
    expect(gun([0, -1, -1, 1, -1, -1])).toEqual([]);
    expect(gun([0, -1, 1, -1, -1, -1])).toEqual([]);
    const shots = gun([0, 1, -1, -1, -1, -1]);
    expect(shots.length).toBeGreaterThan(10);
    expect(new Set(shots)).toEqual(new Set([1]));
  });

  it('the enemy Console shows an airborne one only while a Soldier of theirs sees it, over a wall; lost, it leaves a fading Last Known Position', () => {
    // pact's 2 and 3 face east behind the wall; the empty helicopter hovers out of their sight, then over the wall in it, then out again
    const m = sky({ 2: { x: -120, y: 0, fx: 1, fy: 0 }, 3: { x: -120, y: 4, fx: 1, fy: 0 } }, { airborne: true, seats: [-1, -1, -1, -1] }, { heliHp: 1e9 });
    const out = { x: -120 + DEFAULT_TUNE.visionM * DEFAULT_TUNE.vehicleVisionMul + 20, y: 0 };
    const heli = (v: CommanderView) => v.vehicles!.find((x) => x.id === 4);
    Object.assign(m.vehicles[0]!, out);
    expect(play(m, HZ, 'pact').views.some(heli)).toBe(false);
    Object.assign(m.vehicles[0]!, { x: 0, y: 0 });
    const seen = play(m, HZ, 'pact').views;
    for (const v of seen) expect(heli(v)).toMatchObject({ side: 'nato', kind: 'helicopter', x: 0, y: 0, airborne: true });
    expect(heli(seen[0]!)!.seats).toBeUndefined(); // an enemy's: position and facing only
    Object.assign(m.vehicles[0]!, out);
    const lost = play(m, 4 * HZ, 'pact').views;
    expect(lost.some(heli)).toBe(false);
    expect(lost[0]!.lastKnown).toEqual([{ x: 0, y: 0, fade: expect.closeTo(1, 1) }]);
    expect(lost.at(-1)!.lastKnown).toEqual([]); // gone lkpSeconds later
  });

  it('a Barrage shell hurts it only on the ground; a Cruise Missile destroys it in the air, and the enemy sees the Wreck only when they saw it die', () => {
    const shell = (airborne: boolean) => {
      const m = sky({}, { airborne, seats: [-1, -1, -1, -1] }, { visionM: 0, barrageCooldownSeconds: 0, barrageShells: 1, barrageSpreadM: 0 });
      play(m, 20 * HZ, 'nato', (m) => (m.tick === 0 ? [{ tick: 0, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: 0, y: 0 } }] : []));
      return m.vehicles[0]!.hp;
    };
    expect(shell(true)).toBe(DEFAULT_TUNE.heliHp);
    expect(shell(false)).toBe(DEFAULT_TUNE.heliHp - DEFAULT_TUNE.shellVehicleDamage);

    const wreck = (watching: boolean) => {
      // pact's 2 and 3 behind the wall, facing it (east) or away; rifles never bring it down (heliHp), the missile does
      const fx = watching ? 1 : -1;
      const m = sky({ 2: { x: -120, y: 0, fx, fy: 0 }, 3: { x: -120, y: 4, fx, fy: 0 } }, { airborne: true, seats: [-1, -1, -1, -1] }, { heliHp: 1e9, missileCooldownSeconds: 0, missileGated: false });
      const { views } = play(m, 30 * HZ, 'pact', (m) => (m.tick === 0 ? [{ tick: 0, side: 'pact', kind: 'asset', asset: 'missile', at: { x: 0, y: 0 } }] : []));
      expect(m.vehicles[0]!.deadAt).toBeGreaterThan(0);
      return views.at(-1)!.vehicles!.find((x) => x.wreck);
    };
    expect(wreck(true)).toMatchObject({ side: 'nato', kind: 'helicopter', x: 0, y: 0 });
    expect(wreck(false)).toBeUndefined();
  });
});

describe('#123 ground-vehicle momentum', () => {
  const jeepScene = (extra: Partial<Tune> = {}, points = [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' as const }]) =>
    scene({ map: { points }, tune: { visionM: 0, squadSize: 4, tanksPerSide: 0, jeepsPerSide: 1, ...extra } });
  const turned = (a: { fx: number; fy: number }, b: { fx: number; fy: number }) => (Math.acos(Math.min(1, a.fx * b.fx + a.fy * b.fy)) * 180) / Math.PI;
  /** Plays on, logging every tick of the first vehicle. */
  function log(m: Match, ticks: number) {
    const v = m.vehicles[0]!;
    const rows = [{ speed: v.speed, x: v.x, y: v.y, fx: v.fx, fy: v.fy }];
    for (let i = 0; i < ticks; i++) (step(m, []), rows.push({ speed: v.speed, x: v.x, y: v.y, fx: v.fx, fy: v.fy }));
    return rows;
  }

  it('a fresh vehicle stands still; a jeep takes about speed / jeepAccel seconds to reach open-ground speed, never gaining more than jeepAccel a tick', () => {
    const m = jeepScene();
    expect(m.vehicles[0]!.speed).toBe(0);
    const rows = log(m, 30 * HZ);
    const start = rows.findIndex((r) => r.speed > 0);
    const top = rows.findIndex((r) => r.speed >= DEFAULT_TUNE.jeepOpenMps - 1e-9);
    expect(start).toBeGreaterThan(0);
    expect((top - start) / HZ).toBeCloseTo(DEFAULT_TUNE.jeepOpenMps / DEFAULT_TUNE.jeepAccel, 0);
    rows.forEach((r, i) => i && expect(r.speed - rows[i - 1]!.speed).toBeLessThanOrEqual(DEFAULT_TUNE.jeepAccel / HZ + 1e-9));
    rows.forEach((r, i) => i && expect(rows[i - 1]!.speed - r.speed).toBeLessThanOrEqual((DEFAULT_TUNE.jeepAccel * DEFAULT_TUNE.brakeMul) / HZ + 1e-9));
  });

  it('a tank sent to a point comes to a stop inside it and never leaves it again', () => {
    const m = scene({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' as const }] }, tune: { visionM: 0 } });
    const rows = log(m, 150 * HZ);
    const inside = (r: { x: number; y: number }) => Math.hypot(r.x + 200, r.y) < 25;
    const first = rows.findIndex(inside);
    expect(first).toBeGreaterThan(0);
    expect(rows.slice(first).every(inside)).toBe(true);
    expect(rows.at(-1)!.speed).toBe(0);
  });

  it('turns by at most the class\'s turn rate a tick, and slows into a right-angle corner and speeds up out of it', () => {
    const m = jeepScene();
    play(m, 6 * HZ); // the Squad climbs in
    Object.assign(m.vehicles[0]!, { x: -400, y: 0, fx: 0, fy: 1, speed: DEFAULT_TUNE.jeepOpenMps }); // rolling north, the way ahead is east
    const rows = log(m, 25 * HZ);
    const cap = DEFAULT_TUNE.jeepTurnDegPerS / HZ + 0.01;
    rows.forEach((r, i) => i && expect(turned(rows[i - 1]!, r)).toBeLessThanOrEqual(cap));
    const speeds = rows.map((r) => r.speed);
    const low = Math.min(...speeds.slice(0, 5 * HZ));
    expect(low).toBeLessThan(DEFAULT_TUNE.jeepOpenMps * 0.8);
    expect(Math.max(...speeds.slice(speeds.indexOf(low)))).toBeGreaterThan(DEFAULT_TUNE.jeepOpenMps - 0.5);
  });

  it('hashes speed', () => {
    const m = scene({});
    const h = stateHash(m);
    m.vehicles[0]!.speed = 3;
    expect(stateHash(m)).not.toBe(h);
  });
});


describe('#124 helicopter flight and Landing Zone', () => {
  // As the #109 ferry: nato's Squad 0..3 boards helicopter 8 on its HQ (-560, 0) and goes to A; the pact's Soldiers stand far off.
  const HQ = { x: -560, y: 0 };
  const A = { x: 300, y: 200 };
  const away = { x: 500, y: -500 };
  const scene124 = (o: { tune?: Partial<Tune>; map?: Partial<MapData>; seed?: number } = {}) => {
    const m = scene({ map: { points: [{ id: 'A', name: 'A', ...A }], ...o.map }, tune: { visionM: 0, squadSize: 4, tanksPerSide: 0, helisPerSide: 1, ...o.tune }, place: { 4: away, 5: away, 6: away, 7: away } });
    if (o.seed) m.rng = o.seed * 7919;
    return m;
  };
  /** The helicopter's state every tick for `seconds`. */
  function flight(m: Match, seconds: number) {
    const h = m.vehicles[0]!;
    const log: { x: number; y: number; fx: number; fy: number; speed: number; airborne: boolean; tick: number }[] = [];
    for (let i = 0; i < seconds * HZ; i++) {
      step(m, []);
      log.push({ x: h.x, y: h.y, fx: h.fx, fy: h.fy, speed: h.speed, airborne: h.airborne, tick: m.tick });
    }
    return { h, log };
  }
  const trips = (log: ReturnType<typeof flight>['log']) => {
    const up = log.findIndex((p) => p.airborne);
    const down = log.findIndex((p, i) => i > up && !p.airborne);
    const up2 = log.findIndex((p, i) => i > down && p.airborne);
    const down2 = log.findIndex((p, i) => i > up2 && !p.airborne);
    return { out: log.slice(up, down), back: log.slice(up2, down2), up, down, up2, down2 };
  };
  /** The signed distance from line a-b of the track's point farthest from it. */
  const bulge = (track: { x: number; y: number }[], a: { x: number; y: number }, b: { x: number; y: number }) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return track.map((q) => ((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / len).reduce((far, d) => (Math.abs(d) > Math.abs(far) ? d : far), 0);
  };
  const farthest = (track: { x: number; y: number }[], a: { x: number; y: number }, b: { x: number; y: number }) =>
    track.reduce((f, q) => (Math.abs(bulge([q], a, b)) > Math.abs(bulge([f], a, b)) ? q : f));

  it('each trip out and home is a dogleg, and the one home is not the one out', () => {
    const { h, log } = flight(scene124(), 90);
    const { out, back } = trips(log);
    const outLen = Math.hypot(h.lz!.x - HQ.x, h.lz!.y - HQ.y);
    expect(Math.abs(bulge(out, HQ, h.lz!))).toBeGreaterThan(0.05 * outLen); // it banks through a waypoint off the line (the turn cuts the corner)
    expect(Math.abs(bulge(back, h.lz!, HQ))).toBeGreaterThan(0.05 * outLen);
    const [p, q] = [farthest(out, HQ, h.lz!), farthest(back, h.lz!, HQ)];
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(10);
  });

  it('a Landing Zone lies lzM from the point on standable ground, and each seed draws its own', () => {
    const zones = [1, 2, 3, 4, 5, 6].map((seed) => {
      const m = scene124({ seed });
      flight(m, 45);
      return m.vehicles[0]!.lz!;
    });
    for (const z of zones) {
      const d = Math.hypot(z.x - A.x, z.y - A.y);
      expect(d).toBeGreaterThanOrEqual(DEFAULT_TUNE.lzM[0] - 0.01);
      expect(d).toBeLessThanOrEqual(DEFAULT_TUNE.lzM[1] + 0.01);
    }
    expect(new Set(zones.map((z) => `${Math.round(z.x)} ${Math.round(z.y)}`)).size).toBeGreaterThan(3);
  });

  it('the Landing Zone is on the far side from an enemy its Squad knows by the point, within lzSpreadDeg of straight away', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = scene124({ seed });
      m.squads[0]!.memory.push({ id: 4, x: A.x + 100, y: A.y, tick: 1e9, source: 'seen' }); // known east of A: it lands west (#129: the pilot goes first, so keep it fresh)
      flight(m, 45);
      const z = m.vehicles[0]!.lz!;
      const cos = (A.x - z.x) / Math.hypot(z.x - A.x, z.y - A.y); // against straight away (west)
      expect(cos, `seed ${seed}`).toBeGreaterThanOrEqual(Math.cos(((DEFAULT_TUNE.lzSpreadDeg + 2.5) * Math.PI) / 180) - 0.01); // bearings are 5° apart: the away one is snapped to the nearest
    }
  });

  it('the Landing Zone is on the far side from an enemy only another friendly Squad knows (#133)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = scene({
        map: { points: [{ id: 'A', name: 'A', ...A }] },
        tune: { visionM: 0, squadSize: 2, tanksPerSide: 0, helisPerSide: 1 },
        squads: 3,
        place: { 4: { x: 0, y: -500 }, 5: { x: 0, y: -500 }, 6: away, 7: away, 8: away, 9: away, 10: away, 11: away },
      });
      m.rng = seed * 7919;
      m.squads[2]!.memory.push({ id: 6, x: A.x + 100, y: A.y, tick: 1e9, source: 'seen' }); // the Squad left behind knows an enemy east of A; the riders' own memory is empty
      flight(m, 45);
      const z = m.vehicles[0]!.lz!;
      const cos = (A.x - z.x) / Math.hypot(z.x - A.x, z.y - A.y);
      expect(cos, `seed ${seed}`).toBeGreaterThanOrEqual(Math.cos(((DEFAULT_TUNE.lzSpreadDeg + 2.5) * Math.PI) / 180) - 0.01);
    }
  });

  it('a dogleg keeps off an enemy-held point on one side and takes the clear side; with nothing in the way both sides turn up', () => {
    const mid = { x: (HQ.x + A.x) / 2, y: (HQ.y + A.y) / 2 };
    const L = Math.hypot(A.x - HQ.x, A.y - HQ.y);
    const n = { x: -(A.y - HQ.y) / L, y: (A.x - HQ.x) / L };
    const P = { x: mid.x + 200 * n.x, y: mid.y + 200 * n.y }; // an enemy-held point 200 m off the middle, on the + side
    const sides = (threat: boolean) =>
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
        const m = scene124({ seed, map: { points: [{ id: 'A', name: 'A', ...A }, ...(threat ? [{ id: 'B', name: 'B', ...P, owner: 'pact' as const }] : [])] }, tune: { lzM: [0, 0] } });
        m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
        const { log } = flight(m, 45);
        const { out } = trips(log);
        const closest = Math.min(...out.map((q) => Math.hypot(q.x - P.x, q.y - P.y)));
        if (threat) expect(closest, `seed ${seed}`).toBeGreaterThanOrEqual(m.points[1]!.radius + DEFAULT_TUNE.heliThreatM);
        return Math.sign(bulge(out, HQ, A));
      });
    expect(new Set(sides(true))).toEqual(new Set([1])); // the clear side
    expect(new Set(sides(false))).toEqual(new Set([-1, 1]));
  });

  it('a dogleg waypoint never lies outside the Play Area, even for a trip along its edge', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = scene124({ seed });
      const w = dogleg(m, { x: -400, y: 590 }, { x: 400, y: 590 }, [])!; // 800 m along the north edge (y = 600): one side would be 120-240 m out
      expect(insidePolygon(m.map.playArea, w.x, w.y), `seed ${seed}: ${w.x.toFixed(0)}, ${w.y.toFixed(0)}`).toBe(true);
    }
  });

  it('a trip shorter than doglegMinM flies straight', () => {
    const m = scene124({ map: { points: [{ id: 'A', name: 'A', x: -460, y: 0 }] }, tune: { lzM: [30, 30] } });
    const h = m.vehicles[0]!;
    [0, 1, 2, 3].forEach((id, k) => (h.seats[k] = id) >= 0 && Object.assign(m.soldiers[id]!, { x: h.x, y: h.y, vehicle: h.id }));
    m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
    const { log } = flight(m, 20);
    const { out } = trips(log);
    expect(out.length).toBeGreaterThan(0);
    expect(Math.abs(bulge(out, HQ, m.vehicles[0]!.lz!))).toBeLessThan(0.5);
  });

  it('a goal changed in flight draws a fresh Landing Zone: it sets down by the new point and its riders get out there, once', () => {
    const B = { x: 300, y: -250 };
    const m = scene124({ map: { points: [{ id: 'A', name: 'A', ...A }, { id: 'B', name: 'B', ...B }] }, tune: { rockets: 0 } }); // the pact's Launcher (Soldier 5, parked far off) would rocket the airborne helicopter without line of sight (`rocketTarget`: airborne vehicles need none, `rocketRangeM` applies regardless of `visionM: 0`); #131: below half its hit points it would drop its riders and fly home to repair, and this test is about the Landing Zone
    const h = m.vehicles[0]!;
    [0, 1, 2, 3].forEach((id, k) => (h.seats[k] = id) >= 0 && Object.assign(m.soldiers[id]!, { x: h.x, y: h.y, vehicle: h.id }));
    m.squads[0]!.order = { point: 0, hold: false, delayed: null, since: 0 };
    flight(m, 15);
    expect(h.airborne).toBe(true);
    m.squads[0]!.order = { point: 1, hold: false, delayed: null, since: m.tick }; // on its way to A, the Squad turns for B
    let boardings = 0;
    let down: { x: number; y: number } | null = null;
    for (let i = 0; i < 60 * HZ; i++) {
      const aboard = h.seats.filter((id) => id > 0).length;
      step(m, []);
      if (h.seats.filter((id) => id > 0).length > aboard) boardings++;
      if (!down && !h.airborne) down = { x: h.x, y: h.y };
    }
    const d = Math.hypot(down!.x - B.x, down!.y - B.y);
    expect(d).toBeLessThanOrEqual(DEFAULT_TUNE.lzM[1] + 0.01);
    expect([1, 2, 3].every((id) => m.soldiers[id]!.vehicle < 0)).toBe(true);
    expect(boardings).toBe(0); // no climbing back in at the old Landing Zone
  });

  it('speeds up or slows by no more than heliAccel, turns by no more than heliTurnDegPerS, and banks through the waypoint without stopping', () => {
    const { log } = flight(scene124(), 90);
    const { out, back } = trips(log);
    const turn = (a: { fx: number; fy: number }, b: { fx: number; fy: number }) => Math.acos(Math.min(1, a.fx * b.fx + a.fy * b.fy)) * (180 / Math.PI);
    log.slice(1).forEach((q, i) => {
      const p = log[i]!;
      expect(q.speed - p.speed, `tick ${q.tick}`).toBeLessThanOrEqual(DEFAULT_TUNE.heliAccel / HZ + 1e-9);
      expect(p.speed - q.speed, `tick ${q.tick}`).toBeLessThanOrEqual(DEFAULT_TUNE.heliAccel / HZ + 1e-9);
      expect(turn(p, q), `tick ${q.tick}`).toBeLessThanOrEqual(DEFAULT_TUNE.heliTurnDegPerS / HZ + 1e-3);
    });
    expect(Math.max(...out.map((q) => q.speed))).toBeCloseTo(DEFAULT_TUNE.heliMps, 1);
    for (const trip of [out, back]) expect(Math.min(...trip.slice(Math.floor(trip.length * 0.35), Math.floor(trip.length * 0.65)).map((q) => q.speed))).toBeGreaterThan(0.8 * DEFAULT_TUNE.heliMps); // round the waypoint at the middle
    expect(Math.max(...out.slice(0, 3).map((q) => q.speed))).toBeLessThan(1); // a pull-away from rest
  });

  it('hovers flareSeconds over its Landing Zone before touching down, and spools spoolSeconds before lift-off', () => {
    const { h, log } = flight(scene124(), 90);
    const { down, up2 } = trips(log);
    let hover = down;
    while (log[hover - 1]!.speed === 0 && log[hover - 1]!.airborne) hover--;
    expect(Math.hypot(log[down]!.x - h.lz!.x, log[down]!.y - h.lz!.y)).toBeLessThan(1e-6);
    expect((down - hover) / HZ).toBeCloseTo(DEFAULT_TUNE.flareSeconds, 0);
    expect(log[down - 1]!.airborne).toBe(true); // still airborne while it hovers
    expect(log.slice(down, up2).every((q) => q.speed === 0)).toBe(true);
    expect((up2 - down) / HZ).toBeCloseTo(DEFAULT_TUNE.unloadSeconds + DEFAULT_TUNE.spoolSeconds, 0);
  });

  it('the Landing Zone, waypoint, flare and spool timers are in the hash', () => {
    const m = scene124();
    const h = m.vehicles[0]!;
    for (const change of [() => (h.lz = { x: 1, y: 2 }), () => (h.wp = { x: 3, y: 4 }), () => (h.flareUntil = 9), () => (h.spoolUntil = 9)]) {
      const before = stateHash(m);
      change();
      expect(stateHash(m)).not.toBe(before);
    }
  });
});
