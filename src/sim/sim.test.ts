import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, stateHash, step, type Match } from './index';
import { DEFAULT_TUNE, NO_TEMPO, NO_TRAITS } from './tune';
import type { Command, CommanderView, MapData, PointView, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

function map(points: { x: number; y: number }[], pactHqX = 3000): MapData {
  return {
    name: 'test',
    playArea: [
      { x: -500, y: -500 },
      { x: pactHqX + 100, y: -500 },
      { x: pactHqX + 100, y: 500 },
      { x: -500, y: 500 },
    ],
    hqs: { nato: { x: -100, y: 0 }, pact: { x: pactHqX, y: 0 } },
    points: points.map((p, i) => ({ id: `p${i}`, name: 'ABCDEFGH'[i]!, ...p })),
  };
}

/** Nobody sees anybody, nobody strays (#93) and no vehicles (#107 #108) unless `tune` says so: these tests check capture and drain with Squads arriving whole and no combat in the way. */
function start(m: MapData, tune: Partial<Tune> = {}, squadsPerSide = 1, seed = 1): Match {
  return createMatch({ seed, map: m, tune: { ...DEFAULT_TUNE, visionM: 0, strayChance: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, pointJeeps: false, ...NO_TRAITS, ...NO_TEMPO, ...tune }, squadsPerSide, commanderSide: 'nato' });
}

/** The nato Commander view, plus the pact Soldiers from the pact view: ground truth the fog hides from nato. */
type Seen = CommanderView & { pact: CommanderView['friendlies'] };

/** Steps `ticks` times and returns what each Side sees after every step. */
function run(match: Match, ticks: number): Seen[] {
  const views: Seen[] = [];
  for (let i = 0; i < ticks; i++) {
    step(match, []);
    views.push({ ...commanderView(match, 'nato'), pact: commanderView(match, 'pact').friendlies });
  }
  return views;
}

const inside = (v: Seen, p: PointView) => {
  const n = (cs: { x: number; y: number }[]) => cs.filter((c) => (c.x - p.x) ** 2 + (c.y - p.y) ** 2 < p.radius ** 2).length;
  return { nato: n(v.friendlies), pact: n(v.pact) };
};

describe('capture', () => {
  it('one Soldier takes a neutral point in 20 s', () => {
    const views = run(start(map([{ x: 0, y: 0 }]), { squadSize: 1 }), 60 * HZ);
    const entered = views.findIndex((v) => inside(v, v.points[0]!).nato === 1);
    const owned = views.findIndex((v) => v.points[0]!.owner === 'nato');
    expect(entered).toBeGreaterThan(0);
    expect((owned - entered + 1) / HZ).toBe(20);
  });

  it('each extra Soldier adds 50% speed, up to 3×', () => {
    const captureSeconds = 120; // slow enough that all six arrive before the point is taken
    const views = run(start(map([{ x: 0, y: 0 }]), { squadSize: 6, speedJitter: 0.5, captureSeconds }), 200 * HZ);
    const speedBySoldiers = new Map<number, number>(); // Soldiers inside -> multiple of one-Soldier speed
    for (let i = 1; i < views.length; i++) {
      const before = views[i - 1]!.points[0]!.progress;
      const after = views[i]!.points[0]!.progress;
      if (after >= 1) break;
      speedBySoldiers.set(inside(views[i]!, views[i]!.points[0]!).nato, Math.round((after - before) * captureSeconds * HZ * 1000) / 1000);
    }
    expect(Object.fromEntries(speedBySoldiers)).toEqual({ 0: 0, 1: 1, 2: 1.5, 3: 2, 4: 2.5, 5: 3, 6: 3 });
  });

  it('a full Squad of 4 takes a neutral point in about 8 s', () => {
    // a Squad walks in as a wedge, a few metres apart: time the capture while all four are inside
    const views = run(start(map([{ x: 0, y: 0 }]), { speedJitter: 0, spread: 0 }), 60 * HZ);
    const secondsPerStage = views.slice(1).flatMap((v, i) => {
      const gained = v.points[0]!.progress - views[i]!.points[0]!.progress;
      return inside(views[i]!, v.points[0]!).nato === 4 && v.points[0]!.progress < 1 ? [Math.round(1 / gained / HZ * 1000) / 1000] : [];
    });
    expect(secondsPerStage.length).toBeGreaterThan(HZ);
    expect(new Set(secondsPerStage)).toEqual(new Set([8]));
  });

  it('equal numbers inside freeze the progress', () => {
    const views = run(start(map([{ x: 0, y: 0 }], 100)), 60 * HZ);
    const isContested = (v: Seen) => {
      const n = inside(v, v.points[0]!);
      return n.nato > 0 && n.nato === n.pact;
    };
    const contested = views.filter(isContested);
    const before = views[views.findIndex(isContested) - 1]!.points[0]!.progress;
    expect(contested.length).toBeGreaterThan(20 * HZ);
    expect(before).not.toBe(0); // one Side got there first and started capturing
    expect(new Set(contested.map((v) => v.points[0]!.progress))).toEqual(new Set([before]));
    expect(contested.every((v) => v.points[0]!.owner === null)).toBe(true);
  });

  // Two points, one near each HQ: each Side takes its own, then goes for the other's.
  const swap = () => run(start(map([{ x: 0, y: 0 }, { x: 200, y: 0 }], 300), { squadSize: 1 }), 150 * HZ);
  const owners = (views: CommanderView[], i: number) =>
    views.map((v) => v.points[i]!.owner).filter((o, k, all) => k === 0 || o !== all[k - 1]);

  it('an enemy point goes to neutral before it can be captured', () => {
    const views = swap();
    expect(owners(views, 0).slice(0, 4)).toEqual([null, 'nato', null, 'pact']);
    expect(owners(views, 1).slice(0, 4)).toEqual([null, 'pact', null, 'nato']);
    const enemyAt = views.findIndex((v) => v.points[1]!.owner === 'pact' && inside(v, v.points[1]!).nato === 1);
    const neutralAt = views.findIndex((v, k) => k > enemyAt && v.points[1]!.owner === null);
    expect((neutralAt - enemyAt + 1) / HZ).toBe(20);
  });

  it('an owned point stays owned with nobody on it', () => {
    const empty = swap().filter((v) => v.points[0]!.owner === 'nato' && inside(v, v.points[0]!).nato + inside(v, v.points[0]!).pact === 0);
    expect(empty.length).toBeGreaterThan(5 * HZ);
  });
});

describe('tickets', () => {
  // Three points close to nato, the pact HQ far away: nato takes them one by one, leads 1, 2 then 3.
  const runaway = (tune: Partial<Tune> = {}) =>
    run(start(map([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: -150 }]), { squadSize: 1, ...tune }, 3), 300 * HZ);
  const lead = (v: CommanderView) =>
    v.points.filter((p) => p.owner === 'nato').length - v.points.filter((p) => p.owner === 'pact').length;

  it('each Side starts with 150', () => {
    const v = commanderView(start(map([{ x: 0, y: 0 }])), 'nato');
    expect(v.tickets).toEqual({ nato: 150, pact: 150 });
  });

  it('the point lead drains 1 enemy Ticket every `drainSeconds` entry for a lead of 1, 2 or 3', () => {
    const views = runaway();
    const intervals: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [] };
    let since = 0;
    for (let i = 1; i < views.length; i++) {
      const [prev, v] = [views[i - 1]!, views[i]!];
      if (v.result) break;
      since = lead(v) === lead(prev) ? since + 1 : 1;
      expect(v.tickets.nato).toBe(150);
      if (v.tickets.pact < prev.tickets.pact) {
        intervals[lead(v)]!.push(since / HZ);
        since = 0;
      }
    }
    expect(intervals[0]).toEqual([]);
    for (const l of [1, 2, 3] as const) {
      const s = DEFAULT_TUNE.drainSeconds[l - 1]!;
      expect(intervals[l]!.length).toBeGreaterThan(0);
      expect(new Set(intervals[l])).toEqual(new Set([s]));
    }
  });

  it('a lead of 4 or 5 drains faster than a lead of 3, and each step up is faster', () => {
    const lost = (lead: number) => {
      const m = start(map([0, 1, 2, 3, 4].map((i) => ({ x: i * 10, y: 0 }))), { squadSize: 1, matchSeconds: 1e6 });
      m.points.forEach((p, i) => (p.owner = i < lead ? 'nato' : null));
      for (let i = 0; i < 60 * HZ; i++) step(m, []);
      return 150 - m.tickets.pact;
    };
    const rates = [1, 2, 3, 4, 5].map(lost);
    expect(rates.every((n, i) => i === 0 || n > rates[i - 1]!)).toBe(true);
  }, 15_000); // five minutes of Match on a 3.6 km map: ~3.5 s alone, past 5 s beside the rest of the suite

  it('a Side loses the moment its Tickets reach 0', () => {
    const views = runaway({ tickets: 20 });
    const end = views.findIndex((v) => v.result !== null);
    expect(views[end]!.tickets.pact).toBe(0);
    expect(views[end - 1]!.tickets.pact).toBe(1);
    expect(views[end]!.result).toEqual({ winner: 'nato', reason: 'tickets' });
    expect(views.at(-1)).toEqual(views[end]); // nothing moves after the end
  });

  it('at the 25 min cap, equal Tickets are a draw', () => {
    const views = run(start(map([{ x: 0, y: 0 }], 100)), 26 * 60 * HZ);
    const end = views.find((v) => v.result !== null)!;
    expect(end.seconds).toBe(25 * 60);
    expect(end.result).toEqual({ winner: null, reason: 'time' });
  });

  it('at the cap, the Side with more Tickets wins', () => {
    const views = runaway({ matchSeconds: 60 });
    const end = views.find((v) => v.result !== null)!;
    expect(end.seconds).toBe(60);
    expect(end.tickets.nato).toBeGreaterThan(end.tickets.pact);
    expect(end.result).toEqual({ winner: 'nato', reason: 'time' });
  });
});

describe('determinism', () => {
  const field = map([{ x: 0, y: 150 }, { x: 0, y: 0 }, { x: 0, y: -150 }], 100);
  const log: Command[] = [
    { tick: 10, side: 'nato', kind: 'order', squad: 0, point: 'p1' },
    { tick: 200, side: 'nato', kind: 'asset', asset: 'scan', at: { x: 0, y: 0 } },
  ];
  const hashes = (seed: number) => {
    const m = start(field, { visionM: DEFAULT_TUNE.visionM }, 3, seed); // combat on: the squads meet and fight
    const out: string[] = [];
    for (let t = 0; t < 120 * HZ; t++) {
      step(m, log.filter((c) => c.tick === t));
      out.push(stateHash(m));
    }
    return out;
  };

  it('the same seed and Command log give the same state hash', () => {
    expect(hashes(42)).toEqual(hashes(42));
  });

  it('different seeds diverge', () => {
    expect(hashes(42).at(-1)).not.toBe(hashes(43).at(-1));
  });
});

describe('squads', () => {
  it('fields any number of Squads per Side', () => {
    const m = start(map([{ x: 0, y: 0 }]), {}, 8);
    expect(commanderView(m, 'nato').friendlies).toHaveLength(32);
    expect(commanderView(m, 'pact').friendlies).toHaveLength(32);
  });
});

describe('commands', () => {
  const field = map([{ x: 0, y: 0 }]); // one Squad a Side: nato Squad 0, pact Squad 1
  const rejected = (command: Command) => step(start(field), [command]).filter((e) => e.kind === 'rejected');

  it("an Order for a Squad the Side doesn't command is rejected", () => {
    const order: Command = { tick: 0, side: 'nato', kind: 'order', squad: 1, point: 'p0' };
    expect(rejected(order)).toEqual([{ kind: 'rejected', side: 'nato', command: order, reason: 'unknown squad' }]);
    expect(rejected({ ...order, squad: 9 })).toHaveLength(1);
  });

  it('an Order naming a Capture Point the map lacks is rejected', () => {
    const order: Command = { tick: 0, side: 'nato', kind: 'order', squad: 0, point: 'Z' };
    expect(rejected(order)).toEqual([{ kind: 'rejected', side: 'nato', command: order, reason: 'unknown point' }]);
  });

  it('an Order for an own Squad, a cleared Order and an Asset are accepted', () => {
    expect(rejected({ tick: 0, side: 'pact', kind: 'order', squad: 1, point: 'p0' })).toEqual([]);
    expect(rejected({ tick: 0, side: 'nato', kind: 'order', squad: 0, point: null })).toEqual([]);
    expect(rejected({ tick: 0, side: 'nato', kind: 'asset', asset: 'scan', at: { x: 0, y: 0 } })).toEqual([]);
  });
});
