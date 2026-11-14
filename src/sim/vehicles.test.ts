// The shared Vehicle rules (#107 and on), through the Simulation interface: boarding, the kill table, Wrecks and the respawn,
// the seats a Soldier coming back takes, the views, the slots (#154 map data), point vehicles (#108), ground momentum (#123) and
// the body's hash. Each kind's own rules are tested beside its module (vehicles/tank.test.ts, jeep, aa, helicopter, jet).
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { ticketsStart } from './capture';
import { DEFAULT_TUNE } from './tune';
import { crew, field, play, scene, vehicle, viewOf } from './test-scene';
import type { CommanderView, Tune } from './types';
import { leave } from './vehicles';

const HZ = DEFAULT_TUNE.hz;

/** A test scene with one tank a Side: with Squads of two, nato's Soldiers are 0 and 1, pact's 2 and 3, nato's tank 4 and pact's 5. */
const tanks = (o: Parameters<typeof scene>[0] = {}) => scene({ ...o, tune: { tanksPerSide: 1, ...o.tune } });

const tankOf = (v: CommanderView) => v.vehicles!.find((x) => x.side === v.side && !x.wreck)!;

describe('#107 boarding: a Squad at its HQ takes the tank to a far Capture Point', () => {
  // A pact-owned point 360 m out from the nato HQ, two pact Soldiers holding it
  const enemyPoint = { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' as const }] };

  it('both Soldiers board (the first drives), it drives to the point and parks inside it, and they count for the capture', () => {
    const m = tanks({ map: enemyPoint, tune: { visionM: 0 } });
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
    const near = tanks({ map: { points: [{ id: 'A', name: 'A', x: -440, y: 0 }] }, tune: { visionM: 0 } });
    expect(tankOf(play(near, 2 * HZ).views.at(-1)!).seats).toEqual([-1, -1]);
    const away = tanks({ map: enemyPoint, tune: { visionM: 0 }, place: { 0: { x: -500, y: 0 }, 1: { x: -500, y: 0 } } });
    expect(tankOf(play(away, 2 * HZ).views.at(-1)!).seats).toEqual([-1, -1]);
  });

  it('a lone driver waits boardWaitSeconds for others before it leaves', () => {
    const m = tanks({ map: enemyPoint, tune: { visionM: 0, squadSize: 1 } });
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
    tanks({
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
    const m = tanks({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' }] }, tune: { tankRangeM: 0, coaxRangeM: 0, walkSpeed: 0 }, place: { 2: { x: -330, y: 30 }, 3: { x: -330, y: 30 } } });
    const { events, views } = play(m, 60 * HZ);
    expect(events.filter((e) => e.kind === 'shot' && e.to === 4)).toHaveLength(2);
    expect(views.at(-1)!.vehicles!.find((x) => x.id === 4)!.hp).toBeCloseTo(0.3);
  });

  it('a Barrage shell on the hull costs 35; a Cruise Missile destroys it, the crew die (a Ticket each) and the caller scores them at the shell tariff', () => {
    const shell = tanks({ tune: { visionM: 0, barrageCooldownSeconds: 0, barrageShells: 1, barrageSpreadM: 0 } });
    crew(shell, vehicle(shell, 'tank'), [0, 1], { x: 0, y: 0 });
    play(shell, 20 * HZ, 'nato', (m) => (m.tick === 0 ? [{ tick: 0, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: 0, y: 0 } }] : []));
    expect(viewOf(shell, 4)!.hp).toBe(0.65);
    expect(viewOf(shell, 4)!.seats).toEqual([0, 1]); // inside the blast, but aboard

    const missile = tanks({ tune: { visionM: 0, missileCooldownSeconds: 0, missileGated: false } });
    crew(missile, vehicle(missile, 'tank'), [0, 1], { x: 0, y: 0 });
    const { events } = play(missile, 30 * HZ, 'pact', (m) => (m.tick === 0 ? [{ tick: 0, side: 'pact', kind: 'asset', asset: 'missile', at: { x: 0, y: 0 } }] : []));
    expect(events.filter((e) => e.kind === 'death').map((e) => (e as { id: number }).id).sort()).toEqual([0, 1]);
    expect(events.filter((e) => e.kind === 'award' && e.side === 'pact')).toEqual([
      expect.objectContaining({ category: 'artillery', points: DEFAULT_TUNE.scoreArtilleryKill }),
      expect.objectContaining({ category: 'artillery', points: DEFAULT_TUNE.scoreArtilleryKill }),
    ]);
    expect(viewOf(missile, 4)).toBeUndefined();
    expect(commanderView(missile, 'nato').vehicles).toContainEqual(expect.objectContaining({ kind: 'tank', wreck: true, x: 0, y: 0 }));
    expect(missile.tickets.nato).toBe(ticketsStart(missile) - 2); // one Ticket each
  });

  it('the crew get out under a third of its hit points, and the abandoned tank stays where it stopped', () => {
    const m = tanks({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' }] }, tune: { visionM: 0, walkSpeed: 0 } });
    play(m, 10 * HZ);
    vehicle(m, 'tank').hp = 30; // a map script's damage
    const { views } = play(m, 30 * HZ);
    const v = views.at(-1)!;
    expect(tankOf(v).seats).toEqual([-1, -1]);
    expect(v.friendlies.every((f) => f.vehicle === undefined)).toBe(true);
    expect(tankOf(views[2 * HZ]!)).toMatchObject({ x: tankOf(v).x, y: tankOf(v).y });
  });
});

describe('#107 coming back into a seat', () => {
  it('a dead member Squad Respawns into a free seat of the Squad Leader\'s tank', () => {
    const m = tanks({ tune: { squadSize: 3, visionM: 0 } });
    crew(m, vehicle(m, 'tank'), [0]);
    Object.assign(m.soldiers[1]!, { state: 'dead', deadAt: 0 });
    const { views } = play(m, (DEFAULT_TUNE.respawnSeconds + 1) * HZ);
    expect(viewOf(m, 6)!.seats).toEqual([0, 1]);
    expect(views.at(-1)!.friendlies.find((f) => f.id === 1)!.vehicle).toBe(6);
  });

  it('a dead member with its leader on foot comes back as the driver of an idle tank, and a wiped Squad Redeploys into one', () => {
    const m = tanks({ tune: { squadSize: 3, visionM: 0 } });
    for (const id of [0, 1, 2]) Object.assign(m.soldiers[id]!, { x: -100, y: 0 });
    Object.assign(m.soldiers[1]!, { state: 'dead', deadAt: 0 });
    const v0 = play(m, (DEFAULT_TUNE.respawnSeconds + 1) * HZ).views.at(-1)!;
    expect(tankOf(v0).seats).toEqual([1, -1]);
    expect(v0.friendlies.find((f) => f.id === 1)).toMatchObject({ vehicle: 6, x: -560, y: 0 });

    const wiped = tanks({ tune: { squadSize: 3, visionM: 0 } });
    for (const id of [0, 1, 2]) Object.assign(wiped.soldiers[id]!, { x: -100, y: 0, state: 'dead', deadAt: 0 });
    const v1 = play(wiped, (DEFAULT_TUNE.redeploySeconds + 1) * HZ).views.at(-1)!;
    expect(tankOf(v1).seats).toEqual([0, 1]); // the first two take it; the third Redeploys on foot
    expect(v1.friendlies.find((f) => f.id === 2)!.vehicle).toBeUndefined();
  });
});

describe('#107 views, slots and the hash', () => {
  it('shows a tank with nobody aboard as empty', () => {
    const m = tanks({ tune: { visionM: 0 }, place: { 0: { x: 0, y: 0 }, 1: { x: 0, y: 0 } } });
    expect(tankOf(play(m, 1).views[0]!).empty).toBe(true);
    crew(m, vehicle(m, 'tank'), [0]);
    expect(tankOf(play(m, 1).views[0]!).empty).toBeUndefined();
  });

  it('takes `tanksPerSide` slots in each HQ, each further one 9 m toward the field, ids after the Soldiers', () => {
    const m = tanks({ tune: { tanksPerSide: 3 } });
    expect(m.vehicles.filter((v) => !['gunship', 'drone', 'recon'].includes(v.kind)).map((v) => [v.id, v.side, v.slot.x])).toEqual([ // #101: each Side's Gunship comes last, asleep
      [4, 'nato', -560], [5, 'nato', -551], [6, 'nato', -542],
      [7, 'pact', 560], [8, 'pact', 551], [9, 'pact', 542],
    ]);
  });

  it('hashes every vehicle field, every Wreck and who rides where', () => {
    const m = tanks({ tune: { helisPerSide: 1, jetsPerSide: 1 } }); // #183: a helicopter's and a jet's records too
    const moves = (change: (m: Match) => void) => {
      const h = stateHash(m);
      change(m);
      expect(stateHash(m)).not.toBe(h);
    };
    moves((m) => (m.vehicles[0]!.x += 1));
    moves((m) => (m.vehicles[0]!.hp -= 35));
    moves((m) => crew(m, m.vehicles[0]!, [0])); // its seat, and the Soldier's vehicle
    moves((m) => (m.soldiers[1]!.vehicle = 4));
    moves((m) => (m.soldiers[1]!.rockets -= 1));
    moves((m) => (m.vehicles[1]!.target = 0));
    moves((m) => m.wrecks.push({ side: 'nato', kind: 'tank', x: 1, y: 2, fx: 1, fy: 0, seen: false, tick: 0 }));
    // #131 helicopter jobs
    const heli = () => vehicle(m, 'helicopter');
    moves(() => (heli().heli.job = 'support'));
    moves(() => (heli().heli.fetch = 3));
    moves(() => (heli().heli.spot = { x: 1, y: 2 }));
    moves(() => (heli().heli.spin = -1));
    moves(() => (heli().heli.until = 99));
    moves(() => (heli().heli.hotDrop = true));
    moves(() => (heli().heli.crashAt = 99));
    // #110 the jet's sortie
    const jet = () => vehicle(m, 'jet');
    moves(() => (jet().sortie.stage = 'turning'));
    moves(() => (jet().sortie.passes = 3));
    moves(() => (jet().sortie.bombs = 1));
    moves(() => (jet().sortie.prey = 2));
    moves((m) => m.vehicles[0]!.missiles.push({ x: 1, y: 2, fx: 1, fy: 0, prey: 3, launch: 0, missed: false }));
    moves((m) => m.vehicles[0]!.rounds.push({ x0: 0, y0: 0, x: 1, y: 2, launch: 0, land: 9, bomb: true }));
    // #129 crew and #130 parachute, per Soldier
    moves((m) => (m.soldiers[0]!.crew = true));
    moves((m) => (m.soldiers[0]!.crewUntil = 99));
    moves((m) => (m.soldiers[0]!.crewSeat = 2));
    moves((m) => (m.soldiers[0]!.chute = { t0: 1, t1: 9, x0: 0, y0: 0, x1: 5, y1: 5 }));
  });

  it('hashes the dismount stop, when it last moved, and each passenger\'s way out', () => {
    const m = scene({ tune: { jeepsPerSide: 1 } });
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

describe('#154 vehicles are map data', () => {
  // Each Side lists two tank slots, a jeep's and an AA's, two helipads and two jets; A (nato's) a jeep, the middle point M none,
  // neutral D a tank and a jeep. Soldiers are ids 0..7, so the vehicles start at 8.
  const hq = (s: number) => ({
    slots: [{ kind: 'tank' as const, x: -500 * s, y: -20 }, { kind: 'tank' as const, x: -500 * s, y: 20 }, { kind: 'jeep' as const, x: -490 * s, y: 20 }, { kind: 'aa' as const, x: -480 * s, y: 20 }],
    pads: [{ x: -520 * s, y: -30 }, { x: -520 * s, y: 30 }],
  });
  const map = field({
    vehicleSlots: { nato: hq(1).slots, pact: hq(-1).slots },
    helipad: { nato: hq(1).pads, pact: hq(-1).pads },
    jets: { nato: 2, pact: 2 },
    points: [
      { id: 'A', name: 'A', x: -300, y: 0, owner: 'nato', vehicles: [{ kind: 'jeep', x: -300, y: 10 }] },
      { id: 'M', name: 'M', x: 0, y: 0 },
      { id: 'D', name: 'D', x: 300, y: 0, vehicles: [{ kind: 'tank', x: 300, y: -10 }, { kind: 'jeep', x: 300, y: 10 }] },
    ],
  });
  const made = (tune: Partial<Tune> = {}) =>
    createMatch({ seed: 1, map, tune: { ...DEFAULT_TUNE, ...tune }, squadsPerSide: 1, commanderSide: 'nato' }).vehicles.filter((v) => !['gunship', 'drone', 'recon'].includes(v.kind)).map((v) => [v.id, v.side, v.kind, v.slot.x, v.slot.y, v.point, v.deadAt === -1]); // #101: the Gunships come after, asleep off the map

  it('the tune keys default to the map\'s counts: every slot and pad gets its vehicle, each point the ones it lists, ids in the old order', () => {
    expect(made()).toEqual([
      [8, 'nato', 'tank', -500, -20, -1, true], [9, 'nato', 'tank', -500, 20, -1, true], [10, 'nato', 'jeep', -490, 20, -1, true],
      [11, 'nato', 'helicopter', -520, -30, -1, true], [12, 'nato', 'helicopter', -520, 30, -1, true],
      [13, 'pact', 'tank', 500, -20, -1, true], [14, 'pact', 'tank', 500, 20, -1, true], [15, 'pact', 'jeep', 490, 20, -1, true],
      [16, 'pact', 'helicopter', 520, -30, -1, true], [17, 'pact', 'helicopter', 520, 30, -1, true],
      [18, 'nato', 'jeep', -300, 10, 0, true], [19, 'nato', 'tank', 300, -10, 2, false], [20, 'nato', 'jeep', 300, 10, 2, false], // D's wait for an owner
      [21, 'nato', 'jet', -1700, 0, -1, true], [22, 'nato', 'jet', -1700, 0, -1, true], [23, 'nato', 'aa', -480, 20, -1, true],
      [24, 'pact', 'jet', 1700, 0, -1, true], [25, 'pact', 'jet', 1700, 0, -1, true], [26, 'pact', 'aa', 480, 20, -1, true],
    ]);
  });

  it('a number overrides the map: the first slots of that kind, then 9 m apart toward the field past the Side\'s last slot; pointJeeps off drops the point vehicles', () => {
    expect(made({ tanksPerSide: 1, jeepsPerSide: 2, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 1, pointJeeps: false })).toEqual([
      [8, 'nato', 'tank', -500, -20, -1, true], [9, 'nato', 'jeep', -490, 20, -1, true], [10, 'nato', 'jeep', -471, 20, -1, true],
      [11, 'pact', 'tank', 500, -20, -1, true], [12, 'pact', 'jeep', 490, 20, -1, true], [13, 'pact', 'jeep', 471, 20, -1, true],
      [14, 'nato', 'aa', -480, 20, -1, true], [15, 'pact', 'aa', 480, 20, -1, true],
    ]);
  });
});

describe('#108 a jeep at a Capture Point, for its owner', () => {
  // A neutral, C in the middle (#154: it lists no vehicle), E pact's from the start; nato's Soldiers stand in A, pact's in C. Vehicles: A's jeep 4, E's 5
  const jeep = (x: number) => [{ kind: 'jeep' as const, x, y: 0 }];
  const points = () =>
    scene({
      map: { points: [{ id: 'A', name: 'A', x: -300, y: 0, vehicles: jeep(-300) }, { id: 'C', name: 'C', x: 0, y: 0 }, { id: 'E', name: 'E', x: 300, y: 0, owner: 'pact', vehicles: jeep(300) }] },
      tune: { pointJeeps: true, visionM: 0, walkSpeed: 0, rockets: 0, boardM: 0 }, // nobody drives off in them
      place: { 0: { x: -300, y: 0 }, 1: { x: -300, y: 5 }, 2: { x: 0, y: 0 }, 3: { x: 0, y: 5 } },
    });
  const jeepAt = (v: CommanderView, p: { x: number; y: number }) => v.vehicles!.find((x) => x.kind === 'jeep' && !x.wreck && Math.hypot(x.x - p.x, x.y - p.y) < 25);

  it('one waits at a point owned from the start; one appears the moment a point is captured; never at a point that lists none', () => {
    const m = points();
    expect(m.vehicles.filter((v) => !['gunship', 'drone', 'recon'].includes(v.kind)).map((v) => [v.id, v.side, v.deadAt === -1])).toEqual([[4, 'nato', false], [5, 'pact', true]]);
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
    expect(viewOf(m, 4)).toBeDefined();
    const dead = m.tick;
    Object.assign(vehicle(m, 'jeep'), { hp: 0, deadAt: dead, x: -250, y: 40 }); // a map script's wreck: it died off the point
    const { views } = play(m, 61 * HZ);
    const back = views.findIndex((v) => jeepAt(v, { x: -300, y: 0 }));
    expect((back + 1) / HZ).toBeCloseTo(DEFAULT_TUNE.vehicleRespawnSeconds, 0);
    expect(m.tick - dead).toBeGreaterThan(back);
    expect(jeepAt(views.at(-1)!, { x: -300, y: 0 })).toMatchObject({ side: 'nato', hp: 1 });
  });

  it('#154: an empty one parked in its slot changes hands with its point, as a fresh one; one with a rider aboard does not', () => {
    // pact holds A from the start, its jeep 4 parked just outside the ring; nato's Squad stands in A. Pact's Soldier 3 may sit in
    // the jeep as a passenger, with no driver (Soldier 2 drove it there and stepped out): nothing moves it, and it never gets out on its own
    const taken = (aboard: boolean) => {
      const m = scene({
        map: { points: [{ id: 'A', name: 'A', x: -300, y: 0, owner: 'pact', vehicles: [{ kind: 'jeep', x: -300, y: 35 }] }] },
        tune: { pointJeeps: true, visionM: 0, walkSpeed: 0, rockets: 0, boardM: 0, stillSeconds: 1e9, dismountM: 0 },
        place: { 0: { x: -300, y: 0 }, 1: { x: -300, y: 5 } },
      });
      const j = vehicle(m, 'jeep', 'pact');
      j.hp = 20; // a scratched one: the hand-over is a fresh vehicle
      if (aboard) {
        crew(m, j, [2, 3]);
        leave(m, m.soldiers[2]!);
      }
      for (let i = 0; i < 120 * HZ && m.points[0]!.owner !== 'nato'; i++) step(m, []);
      expect(m.points[0]!.owner).toBe('nato');
      step(m, []); // the vehicle phase runs before the capture phase: it sees the new owner next tick
      return m;
    };
    expect(viewOf(taken(false), 4)).toMatchObject({ side: 'nato', x: -300, y: 35, hp: 1, seats: [-1, -1, -1, -1] });
    expect(viewOf(taken(true), 4, 'pact')).toMatchObject({ side: 'pact', hp: 20 / DEFAULT_TUNE.jeepHp, seats: [-1, 3, -1, -1] });
  });
});

describe('#123 ground-vehicle momentum', () => {
  const jeepScene = (extra: Partial<Tune> = {}, points = [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' as const }]) =>
    scene({ map: { points }, tune: { visionM: 0, squadSize: 4, jeepsPerSide: 1, ...extra } });
  const turned = (a: { fx: number; fy: number }, b: { fx: number; fy: number }) => (Math.acos(Math.min(1, a.fx * b.fx + a.fy * b.fy)) * 180) / Math.PI;
  /** Plays on, logging every tick of the first vehicle: its speed (the view does not show it), where it is and its facing. */
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
    const m = tanks({ map: { points: [{ id: 'A', name: 'A', x: -200, y: 0, owner: 'pact' as const }] }, tune: { visionM: 0 } });
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
    const m = tanks();
    const h = stateHash(m);
    m.vehicles[0]!.speed = 3;
    expect(stateHash(m)).not.toBe(h);
  });
});
