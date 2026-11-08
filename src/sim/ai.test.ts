import { describe, expect, it } from 'vitest';
import { RIVER_FIELD } from '../maps/river-field';
import { commanderView, createMatch, gridRef, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, MapData, Rect, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

interface Placement {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
  ammo?: number; // rounds
  detached?: boolean; // #106: stands in for a Soldier who left the Squad (later: a vehicle)
}

/**
 * Sets up a scenario on `map`. Soldier ids run nato first, squad by squad, `squadSize` each; Soldiers not placed start at
 * their HQ. Placing Soldiers (and their ammo) is the only reach past the Simulation interface: it stands in for a map script.
 */
function scene(o: { map: MapData; place?: Record<number, Placement>; tune?: Partial<Tune>; squads?: number; seed?: number }): Match {
  const tune: Tune = { ...DEFAULT_TUNE, speedJitter: 0, tanksPerSide: 0, jeepsPerSide: 0, pointJeeps: false, ...o.tune }; // #107 #108: infantry rules only, no vehicles
  const m = createMatch({ seed: o.seed ?? 1, map: o.map, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(o.place ?? {})) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

/** Steps `ticks` times; returns every event and both Sides' views after every step. */
function play(m: Match, ticks: number) {
  const events: (SimEvent & { tick: number })[] = [];
  const nato: CommanderView[] = [];
  const pact: CommanderView[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = m.tick;
    for (const e of step(m, [])) events.push({ ...e, tick });
    nato.push(commanderView(m, 'nato'));
    pact.push(commanderView(m, 'pact'));
  }
  return { events, nato, pact };
}

const routes = (v: CommanderView) => v.squads.map((q) => q.route);

/** Open ground 1200 m across, HQs far out on the flanks. */
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
    grid: { cols: 16, rows: 16, squareM: 75, letters: 'ABCDEFGHIJKLMNOP' },
    ...extra,
  };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('routes over the river', () => {
  const toE: MapData = { ...RIVER_FIELD, points: RIVER_FIELD.points.filter((p) => p.id === 'E') };
  const calm: Partial<Tune> = { visionM: 0, routeJitterM: 0 };

  it('a Squad crosses the river only at a crossing, by the shortest route', () => {
    const { nato } = play(scene({ map: toE, tune: calm }), 150 * HZ);
    expect(nato[HZ]!.squads[0]).toMatchObject({ task: 'move', point: 'E', route: 'N' });
    for (const v of nato) for (const f of v.friendlies) if (Math.abs(f.x) < 6) expect(Math.abs(f.y - 120)).toBeLessThanOrEqual(3);
    const there = nato.findIndex((v) => v.friendlies.every((f) => Math.hypot(f.x - 100, f.y - 140) < 25));
    expect(there).toBeGreaterThan(0);
  });

  it('Squads going to the same point spread over the crossings, never taking one more than 150 m longer', () => {
    // the bridge is 26 m longer than the footbridge, the ford 200 m: a mate on a route adds 80 m to it, so the seventh
    // Squad would find the ford shortest (617 m against 655 and 681) were it not too far round
    const { nato } = play(scene({ map: toE, tune: calm, squads: 7 }), HZ + 1);
    expect(routes(nato[HZ]!).sort()).toEqual(['C', 'C', 'C', 'N', 'N', 'N', 'N']);
  });

  it('seeded jitter varies the pick between near-equal routes', () => {
    const picks = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => routes(play(scene({ map: toE, tune: { visionM: 0 }, seed }), HZ + 1).nato[HZ]!)[0]));
    expect(picks).toEqual(new Set(['N', 'C']));
  });

  // Two Squads of 2 a Side. nato Squad 0 (ids 0, 1) runs into the enemy at the footbridge; Squad 1 (ids 2, 3) decides its
  // route from the HQ a second later. `kind` sets what kind of crossing N is (C becomes a footbridge when N is the bridge).
  const atTheFootbridge = (place: Record<number, Placement>, tune: Partial<Tune>, kind: 'footbridge' | 'bridge' = 'footbridge') => {
    const map = { ...toE, crossings: toE.crossings!.map((c) => (c.id === 'N' ? { ...c, kind } : c.id === 'C' ? { ...c, kind: 'footbridge' as const } : c)) };
    const m = scene({ map, place, tune: { routeJitterM: 0, spread: 0, squadSize: 2, ...tune }, squads: 2 });
    return play(m, HZ + 1).nato[HZ]!.squads[1]!.route;
  };
  // Squad 0 is already over (on E's bank, so it takes no crossing and adds no mate penalty to one).
  // ids 0 and 1 see pact ids 4 and 5 by the footbridge, 40 m off
  const seen = { 0: { x: 60, y: 118, fx: -1 }, 1: { x: 60, y: 122, fx: -1 }, 4: { x: 20, y: 118 }, 5: { x: 20, y: 122 } };
  // ids 0 and 1 face west at the footbridge; ids 4 and 5 shoot them dead from behind, unseen
  const lost = { 0: { x: 10, y: 118, fx: -1 }, 1: { x: 10, y: 122, fx: -1 }, 4: { x: 90, y: 118, fx: -1 }, 5: { x: 90, y: 122, fx: -1 } };
  const killed: Partial<Tune> = { hitChance: 1, damage: [100, 100], reviveRangeM: 0, bleedOutSeconds: 1 / HZ };

  it('enemies seen at a crossing send the next Squad over another one', () => {
    expect(atTheFootbridge(seen, { hp: 1e9 })).toBe('C');
  });

  it('own losses at a crossing send the next Squad over another one', () => {
    expect(atTheFootbridge(lost, killed)).toBe('C');
  });

  it('the centre bridge takes no danger penalties', () => {
    expect(atTheFootbridge(seen, { hp: 1e9 }, 'bridge')).toBe('N');
    expect(atTheFootbridge(lost, killed, 'bridge')).toBe('N');
  });
});

describe('point choice', () => {
  // nato Squads of 1. Enemy point P and neutral point R are the same distance from the nato HQ; nobody sees anybody.
  // Squad 0 starts at P and decides first; the others decide at the HQ, Squad 2 before Squad 1.
  const picks = (squads: number, pOwner: 'pact' | null = 'pact') => {
    const points = [{ id: 'P', name: 'P', x: -460, y: 150, owner: pOwner }, { id: 'R', name: 'R', x: -460, y: -150 }];
    const m = scene({ map: field({ points }), place: { 0: { x: -460, y: 150 } }, tune: { squadSize: 1, visionM: 0, spread: 0 }, squads });
    return play(m, HZ + 1).nato[HZ]!.squads.map((q) => q.point);
  };

  it('a second Squad pairs up to assault an enemy point, though a neutral one scores higher alone', () => {
    expect(picks(2)).toEqual(['P', 'P']);
  });

  it('a third Squad does not join them', () => {
    expect(picks(3)).toEqual(['P', 'R', 'P']);
  });

  it('Squads spread out over neutral points', () => {
    expect(picks(2, null)).toEqual(['P', 'R']);
  });
  it('a Squad on its own quiet point leaves it for an enemy point, however far; one under threat it holds', () => {
    const points = [{ id: 'A', name: 'A', x: -300, y: 0, owner: 'nato' as const }, { id: 'E', name: 'E', x: 450, y: 0, owner: 'pact' as const }];
    const quiet = scene({ map: field({ points }), place: { 0: { x: -300, y: 0 } }, tune: { squadSize: 1, visionM: 0, spread: 0 } });
    expect(play(quiet, 2 * HZ).nato.at(-1)!.squads[0]!.point).toBe('E');
    const pact = { x: -300, y: 10 }; // the pact Soldier stands inside A
    const held = scene({ map: field({ points }), place: { 0: { x: -300, y: 0 }, 1: pact }, tune: { squadSize: 1, visionM: 0, spread: 0, walkSpeed: 0 } });
    expect(play(held, 2 * HZ).nato.at(-1)!.squads[0]!.point).toBe('A');
  });
});

describe('loose squads', () => {
  it('a travelling Squad moves as a wedge: the leader in front, the others behind on both sides, spaced out', () => {
    const m = scene({ map: field({ points: [{ id: 'P', name: 'P', x: 300, y: 0 }] }), tune: { visionM: 0, strayChance: 0 } });
    const { nato } = play(m, 30 * HZ);
    const v = nato.at(-1)!;
    const lead = v.friendlies.reduce((a, b) => (b.x > a.x ? b : a));
    const rest = v.friendlies.filter((f) => f !== lead);
    expect(rest.every((f) => lead.x - f.x > 3 && dist(f, lead) < 25)).toBe(true);
    expect(rest.some((f) => f.y > lead.y + 2) && rest.some((f) => f.y < lead.y - 2)).toBe(true);
    for (const a of v.friendlies) for (const b of v.friendlies) if (a !== b) expect(dist(a, b)).toBeGreaterThan(2.5);
  });

  it('#93: a travelling mate strays from the wedge when the chance says so, never past the leash, and not at all at 0', () => {
    const far = { map: field({ points: [{ id: 'P', name: 'P', x: 500, y: 0 }] }) };
    const offWedge = (v: CommanderView) => {
      const lead = v.friendlies.reduce((a, b) => (b.x > a.x ? b : a));
      return v.friendlies.filter((f) => f !== lead && Math.abs(f.y - lead.y) > 9); // a rank-one wedge slot sits at most 7 m out
    };
    const { nato: still } = play(scene({ ...far, tune: { visionM: 0, strayChance: 0 } }), 60 * HZ);
    expect(still.slice(10 * HZ).every((v) => offWedge(v).length === 0)).toBe(true); // once the spawn spread has closed into the wedge

    const { nato: loose } = play(scene({ ...far, tune: { visionM: 0, strayChance: 1 } }), 60 * HZ);
    expect(loose.some((v) => offWedge(v).length > 0)).toBe(true);
    for (const v of loose) {
      const lead = v.friendlies.reduce((a, b) => (b.x > a.x ? b : a));
      for (const f of v.friendlies) expect(dist(f, lead)).toBeLessThan(DEFAULT_TUNE.leashM + 20);
    }
    expect(loose.at(-1)!.friendlies.reduce((a, b) => (b.x > a.x ? b : a)).x).toBeGreaterThan(still.at(0)!.friendlies[0]!.x + 50); // the leader still gets on
  });

  it('#106: the wedge forms on the first on-foot member when the Squad Leader is Detached, who stays the leader', () => {
    // the Squad Leader (id 0) starts Detached 200 m north of the HQ; the rest set off from the HQ for P
    const m = scene({ map: field({ points: [{ id: 'P', name: 'P', x: 300, y: 0 }] }), place: { 0: { x: -560, y: 200, detached: true } }, tune: { visionM: 0, strayChance: 0, spread: 0 } });
    const v = play(m, 30 * HZ).nato.at(-1)!;
    const at = (id: number) => v.friendlies.find((f) => f.id === id)!;
    for (const id of [2, 3]) expect(at(1).x - at(id).x > 3 && dist(at(id), at(1)) < 25).toBe(true);
    expect(dist(at(0), at(1))).toBeGreaterThan(50);
    expect(at(0).x).toBeGreaterThan(-460); // walks its own line to the Squad's goal
    expect(v.squads[0]!.leader).toBe(0);
  });

  // #106: with `detachM` under the 22 m the wedge reaches, a stray that ends out of it goes Detached
  const loose: Partial<Tune> = { visionM: 0, strayChance: 1, squadPull: 0, detachM: 20 };
  const detachedIds = (m: Match) => m.soldiers.filter((s) => s.detached).map((s) => s.id); // not in any CommanderView

  it('#106: strays go Detached, walk on to the Squad\'s goal and rejoin the Squad there', () => {
    const m = scene({ map: field({ points: [{ id: 'P', name: 'P', x: 0, y: 0 }] }), tune: loose });
    let ever = false;
    for (let i = 0; i < 220 * HZ; i++) {
      step(m, []);
      ever ||= detachedIds(m).length > 0;
    }
    expect(ever).toBe(true);
    expect(detachedIds(m)).toEqual([]);
  });

  it('#106: a Detached Soldier who reaches the Squad\'s goal walks over to the Squad holding it and rejoins', () => {
    const big = field({ points: [{ id: 'P', name: 'P', x: 0, y: 0, radius: 60 }] });
    const place = { 0: { x: -40, y: 0 }, 1: { x: -40, y: 5 }, 2: { x: -40, y: -5 }, 3: { x: 40, y: 0, detached: true } };
    const m = scene({ map: big, place, tune: { visionM: 0, strayChance: 0 } });
    play(m, 30 * HZ);
    expect(detachedIds(m)).toEqual([]);
  });

  it('#106: Detached and its own goal are part of the state hash', () => {
    const m = scene({ map: field() });
    const s = m.soldiers[1]!;
    const h = stateHash(m);
    s.detached = true;
    expect(stateHash(m)).not.toBe(h);
    const d = stateHash(m);
    s.goal = 0;
    expect(stateHash(m)).not.toBe(d);
  });

  it('#106: a Detached Soldier makes for a Capture Point of its own; the Squad still reaches its ordered point', () => {
    // R lies just off the Squad's line to its ordered point P; with no Order bonus only the Squad keeps to P
    const points = [{ id: 'P', name: 'P', x: 300, y: 0 }, { id: 'R', name: 'R', x: -250, y: 40 }];
    const m = scene({ map: field({ points }), tune: { ...loose, orderBonus: 0 } });
    let atR = false;
    let leaderAtP = false;
    for (let i = 0; i < 220 * HZ; i++) {
      step(m, i === 0 ? [{ tick: m.tick, side: 'nato', kind: 'order', squad: 0, point: 'P' }] : []);
      const v = commanderView(m, 'nato');
      atR ||= v.friendlies.some((f) => f.id !== 0 && dist(f, points[1]!) < 25);
      leaderAtP ||= dist(v.friendlies.find((f) => f.id === 0)!, points[0]!) < 25;
    }
    expect(atR).toBe(true);
    expect(leaderAtP).toBe(true);
  });

  it('#106: with `squadPull` high no stray ends Detached over a whole match (15 min at most)', () => {
    const m = createMatch({ seed: 7, map: RIVER_FIELD, tune: { ...DEFAULT_TUNE, squadPull: 10, tanksPerSide: 0, jeepsPerSide: 0, pointJeeps: false }, squadsPerSide: 4, commanderSide: 'nato' });
    for (let i = 0; i < 15 * 60 * HZ; i++) {
      step(m, []);
      if (i % HZ === 0) expect(detachedIds(m)).toEqual([]);
    }
  });

  it('a Soldier more than 60 m from its leader regroups; one within 60 m stays put', () => {
    // no Capture Points: nobody has anywhere to go
    const m = scene({ map: field(), place: { 0: { x: 0, y: 0 }, 1: { x: 0, y: 50 }, 2: { x: 0, y: -100 }, 3: { x: 3, y: 0 } }, tune: { visionM: 0 } });
    const { nato } = play(m, 40 * HZ);
    const at = (id: number) => nato.at(-1)!.friendlies.find((f) => f.id === id)!;
    expect(dist(at(1), { x: 0, y: 50 })).toBeLessThan(1);
    expect(dist(at(2), at(0))).toBeLessThan(15);
  });
});

describe('Retreat', () => {
  const ONE_SHOT: Partial<Tune> = { hitChance: 1, damage: [100, 100], reviveRangeM: 0, bleedOutSeconds: 1 / HZ };
  // nato ids 1-3 and pact ids 5-7 shoot each other dead on tick 0; nato id 0 stands apart facing north and sees nobody.
  // Point M, mid-field, gives both Squads something to go for; `owned` adds a nato point nearer home.
  const downToOne = (owned: boolean) => {
    const points = [{ id: 'M', name: 'M', x: 0, y: 200 }, ...(owned ? [{ id: 'O', name: 'O', x: -200, y: 0, owner: 'nato' as const }] : [])];
    const place: Record<number, Placement> = { 0: { x: 0, y: 30, fx: 0, fy: 1 } };
    for (const i of [1, 2, 3]) Object.assign(place, { [i]: { x: 0, y: i * 5, fx: -1 }, [i + 4]: { x: -100, y: i * 5, fx: 1 } });
    return play(scene({ map: field({ points }), place, tune: ONE_SHOT }), 30 * HZ).nato;
  };

  it('a Squad down to 1 of 4 falls back to the HQ when it owns no point', () => {
    const nato = downToOne(false);
    expect(nato[HZ]!.squads[0]).toMatchObject({ strength: 1, task: 'retreat', point: null });
    const lone = (s: number) => nato[s * HZ]!.friendlies.find((f) => f.id === 0)!;
    expect(lone(8).x).toBeLessThan(lone(1).x - 20); // heading west, home
  });

  it('to the nearest owned, uncontested point when it has one', () => {
    expect(downToOne(true)[HZ]!.squads[0]).toMatchObject({ task: 'retreat', point: 'O' });
  });

  it('ends once the Squad is quiet and back to at least 3 of 4', () => {
    const nato = downToOne(false);
    const back = nato.findIndex((v) => v.squads[0]!.strength >= 3);
    const over = nato.findIndex((v, i) => i > HZ && v.squads[0]!.task !== 'retreat');
    expect(back).toBeGreaterThan(10 * HZ); // Squad Respawn takes 10 s
    expect(over).toBeGreaterThanOrEqual(back);
    expect(over - back).toBeLessThanOrEqual(HZ); // at its next think
  });

  it('a Squad with most members suppressed falls back', () => {
    // four a side trade fire 100 m apart; nobody can hit, every round pins
    const place: Record<number, Placement> = {};
    for (const i of [0, 1, 2, 3]) Object.assign(place, { [i]: { x: 0, y: i * 5, fx: -1 }, [i + 4]: { x: -100, y: i * 5, fx: 1 } });
    const m = scene({ map: field({ points: [{ id: 'M', name: 'M', x: 0, y: 200 }] }), place, tune: { hitChance: 0, suppressPerShot: 1 } });
    const { nato } = play(m, 3 * HZ);
    expect(nato.at(-1)!.squads[0]).toMatchObject({ strength: 4, task: 'retreat' });
  });
});

describe('Resupply', () => {
  // a nato Squad holds its own point with 10 rounds each; nobody sees anybody
  const P = { id: 'P', name: 'P', x: -300, y: 0, owner: 'nato' as const };
  const place: Record<number, Placement> = {};
  for (const i of [0, 1, 2, 3]) place[i] = { x: -300 + i * 4, y: 0, ammo: 10 };
  const run = () => play(scene({ map: field({ points: [P] }), place, tune: { visionM: 0 } }), 150 * HZ).nato;

  it('a Squad nearly out of ammo goes to the HQ for more, then back to the fight', () => {
    const nato = run();
    expect(nato[HZ]!.squads[0]).toMatchObject({ task: 'resupply', point: null });
    const refilled = nato.findIndex((v) => v.friendlies.every((f) => f.ammo === 1));
    expect(refilled).toBeGreaterThan(0);
    expect(nato[refilled]!.friendlies.every((f) => dist(f, field().hqs.nato) < DEFAULT_TUNE.hqRadius + 1)).toBe(true);
    expect(nato.at(-1)!.squads[0]).toMatchObject({ task: 'hold', point: 'P' });
  });

  it('Capture Points never refill ammo', () => {
    const nato = run();
    const left = nato.findIndex((v) => v.friendlies.every((f) => dist(f, P) > DEFAULT_TUNE.captureRadius));
    expect(left).toBeGreaterThan(0);
    expect(nato.slice(0, left).every((v) => v.friendlies.every((f) => f.ammo === 10 / DEFAULT_TUNE.ammo))).toBe(true);
  });
});

/** 2 m cover patches every `step` metres over the box. */
function patches(x0: number, x1: number, y0: number, y1: number, step: number): Rect[] {
  const out: Rect[] = [];
  for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) out.push({ x0: x, y0: y, x1: x + 2, y1: y + 2 });
  return out;
}
const inCover = (cover: Rect[], p: { x: number; y: number }) => cover.some((r) => p.x >= r.x0 && p.x < r.x1 && p.y >= r.y0 && p.y < r.y1);

describe('under fire', () => {
  // A nato Squad walks from x = -80 at enemy point Q, held by a pact Squad facing it, over ground strewn with cover.
  // Nobody can be Wounded, ammo never runs out, and fire barely pins.
  const cover = patches(-80, 120, -40, 40, 4);
  const map = field({ points: [{ id: 'Q', name: 'Q', x: 150, y: 0, owner: 'pact' }], cover });
  const squadsFacing = () => {
    const place: Record<number, Placement> = {};
    for (const i of [0, 1, 2, 3]) Object.assign(place, { [i]: { x: -80, y: i * 4 - 6 }, [i + 4]: { x: 150, y: i * 4 - 6, fx: -1 } });
    return place;
  };
  const attack = () => {
    return play(scene({ map, place: squadsFacing(), tune: { hp: 1e9, suppressPerShot: 0.05, ammo: 1e6 } }), 60 * HZ);
  };

  it('Squad members take cover nearby, at least 5 m apart', () => {
    // one solid block of cover, big enough for all four to bunch up in were they not kept apart
    const block = patches(0, 14, -8, 8, 2);
    const { nato } = play(scene({ map: field({ points: [{ id: 'Q', name: 'Q', x: 150, y: 0, owner: 'pact' }], cover: block }), place: squadsFacing(), tune: { hp: 1e9, suppressPerShot: 0.05, ammo: 1e6 } }), 60 * HZ);
    let crowd = 0;
    let closest = Infinity;
    nato.forEach((v, i) => {
      const inside = v.friendlies.filter((f) => inCover(block, f));
      if (inside.length >= 3) crowd++;
      // the spots are kept apart; a Soldier walking to its spot may pass a settled mate closer
      const settled = inside.filter((f) => i > 0 && dist(f, nato[i - 1]!.friendlies.find((g) => g.id === f.id)!) < 0.05);
      for (const a of settled) for (const b of settled) if (a !== b) closest = Math.min(closest, dist(a, b));
    });
    expect(crowd).toBeGreaterThan(5 * HZ); // three or more spend a good while in the block
    expect(closest).toBeGreaterThanOrEqual(4.5); // 5 m, less a step's slack
  });

  it('a Squad of 3 or more under contact within 130 m flanks: radios the side and grid, and the flankers swing out that way', () => {
    const { nato, pact, events } = attack();
    const flanks = events.filter((e) => e.kind === 'radio' && e.type === 'flanking');
    expect(flanks).toHaveLength(1);
    const call = flanks[0]! as Extract<SimEvent, { kind: 'radio' }> & { tick: number };
    expect(call).toMatchObject({ side: 'nato', squad: 0, text: expect.stringMatching(/^flanking (left|right)$/) });
    expect(pact[call.tick]!.friendlies.map((f) => gridRef(map.grid!, f))).toContain(call.grid);
    // the leader's line to the enemy when the call went out; left is counter-clockwise of it
    const lead = nato[call.tick]!.friendlies[0]!;
    const enemy = { x: 150, y: 0 };
    const side = call.text.endsWith('left') ? 1 : -1;
    const aside = (p: { x: number; y: number }) => (side * ((enemy.x - lead.x) * (p.y - lead.y) - (enemy.y - lead.y) * (p.x - lead.x))) / dist(enemy, lead);
    const within20s = nato.slice(call.tick, call.tick + 20 * HZ);
    expect(within20s.some((v) => v.friendlies.some((f) => aside(f) > 25))).toBe(true);
  });
});

describe('peel-off and suppressive fire', () => {
  // A nato Squad holds its point P; one pact Soldier, 40 m off and facing away, goes down to the first volley and is lost
  // from sight. Nobody else is near.
  const P = { id: 'P', name: 'P', x: 30, y: 0, owner: 'nato' as const };
  const lkp = { x: 60, y: 5 };
  const lostTarget = () => {
    const place: Record<number, Placement> = { 4: { ...lkp, fx: 1 } };
    for (const i of [0, 1, 2, 3]) place[i] = { x: 20, y: i * 6 - 9 };
    return play(scene({ map: field({ points: [P] }), place, tune: { hitChance: 1, damage: [100, 100], reviveRangeM: 0 } }), 15 * HZ);
  };

  it('one healthy Soldier peels off to the Last Known Position of a lost target; the rest hold', () => {
    const { nato } = lostTarget();
    const start = nato[0]!.friendlies;
    const went = start.filter((s) => nato.slice(0, 12 * HZ).some((v) => dist(v.friendlies.find((f) => f.id === s.id)!, lkp) < 15));
    expect(went).toHaveLength(1);
    for (const v of nato) for (const f of v.friendlies) if (f.id !== went[0]!.id) expect(dist(f, P)).toBeLessThan(DEFAULT_TUNE.captureRadius);
  });

  it('the others put suppressive fire on it while it is under 4 s old', () => {
    const { events } = lostTarget();
    const lastSeen = 0; // the pact Soldier went down on tick 0
    const rounds = events.filter((e) => e.kind === 'suppressive') as (Extract<SimEvent, { kind: 'suppressive' }> & { tick: number })[];
    expect(rounds.length).toBeGreaterThan(5);
    expect(rounds.every((e) => e.side === 'nato' && e.tick - lastSeen <= 4 * HZ)).toBe(true);
    expect(rounds.every((e) => Math.abs(e.x - lkp.x) <= 3 && Math.abs(e.y - lkp.y) <= 3)).toBe(true);
  });
});

describe('suppressive fire numbers', () => {
  // nato Soldier 0 holds a fresh seen Last Known Position 60 m off, where pact Soldier 4 stands unseen (nobody sees anyone).
  // Scatter is off, so the round lands on the Soldier; its first one is fired on tick 0.
  const base = (tune: Partial<Tune> = {}) => scene({ map: field(), place: { 0: { x: 0, y: 0, fx: 1 }, 4: { x: 60, y: 0 } }, tune: { visionM: 0, suppressiveScatterM: 0, suppressDecayPerSecond: 0, damage: [1, 1], ...tune } });
  // one tick from a copy of `b` on its own seed (the map grid is shared: building it is the slow part)
  const volley = (b: Match, seed: number) => {
    const m: Match = { ...b, rng: seed, soldiers: structuredClone(b.soldiers), squads: structuredClone(b.squads), points: structuredClone(b.points), sightings: structuredClone(b.sightings) };
    m.squads[0]!.memory.push({ id: 4, x: 60, y: 0, tick: 0, source: 'seen' });
    const events = step(m, []);
    return { events, hit: events.some((e) => e.kind === 'suppressive' && e.hit), suppression: m.soldiers[4]!.suppression };
  };

  it('suppresses the enemy at its Last Known Position by 0.6x a round of aimed fire', () => {
    const { events, suppression } = volley(base(), 1);
    expect(events.filter((e) => e.kind === 'suppressive')).toHaveLength(1);
    expect(suppression).toBeCloseTo(DEFAULT_TUNE.suppressPerShot * 0.6, 9);
  });

  it('hits it at 0.3x the usual chance', () => {
    const rate = (tune: Partial<Tune>) => {
      const b = base(tune);
      let hits = 0;
      for (let seed = 1; seed <= 2000; seed++) if (volley(b, seed).hit) hits++;
      return hits / 2000;
    };
    expect(rate({ hitChance: 1 })).toBeGreaterThan(0.27);
    expect(rate({ hitChance: 1 })).toBeLessThan(0.33);
    expect(rate({ hitChance: 0.5 })).toBeLessThan(0.18); // 0.15: it scales with hitChance
  });
});

describe('hold', () => {
  // A nato Squad holds its point P, ringed with cover; a pact Squad attacks it from 200 m. Nobody can be Wounded.
  const P = { id: 'P', name: 'P', x: 0, y: 0, owner: 'nato' as const };
  const cover = patches(-40, 40, -40, 40, 6);
  const defend = () => {
    const place: Record<number, Placement> = {};
    for (const i of [0, 1, 2, 3]) Object.assign(place, { [i]: { x: -5, y: i * 4 - 6 }, [i + 4]: { x: 200, y: i * 6 - 9, fx: -1 } });
    return play(scene({ map: field({ points: [P], cover }), place, tune: { hp: 1e9, suppressPerShot: 0.05, ammo: 1e6 } }), 90 * HZ);
  };

  it('a holding Squad stays within 1.5x the point radius, in cover in and around it, and chases only inside that leash', () => {
    const { nato, events } = defend();
    expect(events.filter((e) => e.kind === 'shot' && e.side === 'nato').length).toBeGreaterThan(50); // they did fight
    for (const v of nato) for (const f of v.friendlies) expect(dist(f, P)).toBeLessThanOrEqual(1.5 * DEFAULT_TUNE.captureRadius + 0.5);
    expect(nato[15 * HZ]!.squads[0]).toMatchObject({ task: 'hold', point: 'P' });
    expect(nato[15 * HZ]!.friendlies.filter((f) => inCover(cover, f)).length).toBeGreaterThanOrEqual(3);
  });
});
