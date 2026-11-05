import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, MapData, SimEvent, Tune, Vec2 } from './types';

const HZ = DEFAULT_TUNE.hz;

/** Open ground 1200 m across, HQs far out on the flanks, no Capture Points: Soldiers not placed stay at their HQ. */
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
  grid: { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' },
};

type Placement = { x: number; y: number; fx?: number; fy?: number };

/** Like fog.test.ts `scene`: placing Soldiers stands in for a map script; everything after runs through `step`. Nobody fires. */
function scene(place: Record<number, Placement> = {}, o: { tune?: Partial<Tune>; squads?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 1, speedJitter: 0, spread: 0, fireRangeM: 0, ...o.tune };
  const m = createMatch({ seed: 1, map: field, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

const scan = (m: Match, at: Vec2): Command => ({ tick: m.tick, side: 'nato', kind: 'asset', asset: 'scan', at });

/** Steps `ticks` times with no Commands; every event. */
function run(m: Match, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(m, []));
  return events;
}

const rejections = (events: SimEvent[]) => events.flatMap((e) => (e.kind === 'rejected' ? [e.reason] : []));

describe('calling an Asset', () => {
  it('Scan UAV is ready at match start; calling it is accepted with a radio line naming the grid', () => {
    const m = scene();
    expect(commanderView(m, 'nato').assets?.find((a) => a.asset === 'scan')?.readyIn).toBe(0);
    const events = step(m, [scan(m, { x: 50, y: 50 })]);
    expect(rejections(events)).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'radio', side: 'nato', squad: null, grid: 'G6' }));
  });
});
