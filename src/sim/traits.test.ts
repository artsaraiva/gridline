// #120 Squad Traits and point choice: seeded preference, weighted pick, Commitment, aggression (ADR 0006).
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE, NO_TEMPO } from './tune';
import type { Command, MapData, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground; N and S are mirror points either side of the nato HQ line, each 300 m out, so they score alike. */
const field = (points: MapData['points']): MapData => ({
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points,
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
});
const MIRROR = [
  { id: 'N', name: 'N', x: -300, y: -200 },
  { id: 'S', name: 'S', x: -300, y: 200 },
];

function scene(o: { points?: MapData['points']; tune?: Partial<Tune>; seed?: number; frozen?: boolean } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, speedJitter: 0, visionM: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, pointJeeps: false, ...NO_TEMPO, ...(o.frozen && { walkSpeed: 0 }), ...o.tune };
  return createMatch({ seed: o.seed ?? 1, map: field(o.points ?? MIRROR), tune, squadsPerSide: 1, commanderSide: 'nato' });
}
const run = (m: Match, seconds: number, cmds: Command[] = []) => {
  for (let i = 0; i < seconds * HZ; i++) step(m, i === 0 ? cmds : []);
};
const point = (m: Match) => commanderView(m, 'nato').squads[0]!.point;
/** Every second for `seconds`, the point the Squad is on. */
const trail = (m: Match, seconds: number) => {
  const out: (string | null | undefined)[] = [];
  for (let i = 0; i < seconds; i++) {
    run(m, 1);
    out.push(point(m));
  }
  return out;
};
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);

describe('#120 point preference', () => {
  it('opens on different points across seeds, the same point on the same seed', () => {
    const first = (seed: number) => {
      const m = scene({ seed });
      run(m, 1);
      return point(m);
    };
    const opened = seeds.map(first);
    expect(new Set(opened).size).toBe(2);
    expect(first(seeds[0]!)).toBe(opened[0]);
  }, 30_000);
});

describe('#120 Commitment', () => {
  const open = { squadGoalBias: 0, choiceMargin: 5 }; // both points always real options
  it('a Squad holds its self-chosen point for its Commitment, and picks afresh without one', () => {
    for (const seed of seeds) expect(new Set(trail(scene({ seed, frozen: true, tune: { ...open, commitSeconds: [600, 600] } }), 40)).size).toBe(1);
    const flips = seeds.filter((seed) => new Set(trail(scene({ seed, frozen: true, tune: { ...open, commitSeconds: [0, 0] } }), 40)).size > 1);
    expect(flips.length).toBeGreaterThan(0);
  });

  const holding = { ...open, commitSeconds: [600, 600] as [number, number] };
  const other = (p: string | null | undefined) => (p === 'N' ? 'S' : 'N');

  it("ends when the point becomes its own Side's", () => {
    const m = scene({ frozen: true, tune: holding });
    run(m, 3);
    const held = point(m);
    m.points.find((p) => p.id === held)!.owner = 'nato';
    run(m, 2);
    expect(point(m)).toBe(other(held));
  });

  it('ends when an own Capture Point near the leader is threatened', () => {
    const points = [
      { id: 'A', name: 'A', x: -450, y: -60, owner: 'nato' as const },
      { id: 'B', name: 'B', x: -250, y: 250 },
    ];
    const quiet = scene({ points, frozen: true, tune: holding });
    run(quiet, 5);
    expect(point(quiet)).toBe('B');
    const m = scene({ points, frozen: true, tune: holding });
    run(m, 2);
    Object.assign(m.soldiers[4]!, { x: -450, y: -60 }); // a pact Soldier inside A
    run(m, 2);
    expect(point(m)).toBe('A');
  });

  it('ends when an Order arrives or is cleared', () => {
    const points = [
      { id: 'B', name: 'B', x: -380, y: 0 },
      { id: 'C', name: 'C', x: -250, y: 250 },
    ];
    const m = scene({ points, frozen: true, tune: { ...holding, choiceMargin: 0.05 } });
    run(m, 3);
    expect(point(m)).toBe('B');
    run(m, 6, [{ tick: m.tick, side: 'nato', kind: 'order', squad: 0, point: 'C' }]);
    expect(point(m)).toBe('C');
    run(m, 6, [{ tick: m.tick, side: 'nato', kind: 'order', squad: 0, point: null }]);
    expect(point(m)).toBe('B');
  });
});

describe('#120 aggression', () => {
  const pts = [
    { id: 'E', name: 'E', x: -300, y: 200, owner: 'pact' as const },
    { id: 'N', name: 'N', x: -300, y: -200 },
  ];
  const sure = { squadGoalBias: 0, choiceMargin: 0.05 };
  const pick = (aggression: number) => {
    const m = scene({ points: pts, frozen: true, tune: sure });
    m.squads[0]!.aggression = aggression;
    run(m, 1);
    return point(m);
  };
  it('a bold Squad picks an enemy point a cautious one passes over', () => {
    expect(pick(1)).toBe('E');
    expect(pick(-1)).toBe('N');
  });

  it('a bold Squad falls back at a higher suppression than a cautious one', () => {
    const task = (aggression: number) => {
      const m = scene({ frozen: true });
      m.squads[0]!.aggression = aggression;
      for (const i of m.squads[0]!.members) m.soldiers[i]!.suppression = 0.8;
      run(m, 1);
      return commanderView(m, 'nato').squads[0]!.task;
    };
    expect(task(-1)).toBe('retreat');
    expect(task(1)).not.toBe('retreat');
  });
});

describe('#120 Detached Soldiers', () => {
  it('hold their own pick for their own Commitment', () => {
    const goals = (commitSeconds: [number, number], seed: number) => {
      const m = scene({ seed, frozen: true, tune: { squadGoalBias: 0, choiceMargin: 5, squadPull: 0, commitSeconds } });
      Object.assign(m.soldiers[1]!, { detached: true, x: -100, y: 0 });
      const out: number[] = [];
      for (let i = 0; i < 40; i++) {
        run(m, 1);
        out.push(m.soldiers[1]!.goal);
      }
      return out;
    };
    for (const seed of seeds) expect(new Set(goals([600, 600], seed).filter((g) => g >= 0)).size).toBeLessThanOrEqual(1);
    expect(seeds.some((seed) => new Set(goals([0, 0], seed).filter((g) => g >= 0)).size > 1)).toBe(true);
  });
});
