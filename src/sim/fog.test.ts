import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { CommanderView, MapData, Tune } from './types';

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
};

type Placement = { x: number; y: number; fx?: number; fy?: number };

/** Like combat.test.ts `scene`: placing Soldiers stands in for a map script; everything after runs through `step`. Nobody can be Wounded. */
function scene(place: Record<number, Placement>, o: { tune?: Partial<Tune>; map?: Partial<MapData>; squads?: number } = {}): Match {
  const tune: Tune = { ...DEFAULT_TUNE, squadSize: 1, speedJitter: 0, spread: 0, hp: 1e9, ...o.tune };
  const m = createMatch({ seed: 1, map: { ...field, ...o.map }, tune, squadsPerSide: o.squads ?? 1, commanderSide: 'nato' });
  for (const [id, p] of Object.entries(place)) Object.assign(m.soldiers[Number(id)]!, p);
  return m;
}

/** Steps `ticks` times; the nato Commander view after every step. */
function play(m: Match, ticks: number): CommanderView[] {
  const views: CommanderView[] = [];
  for (let i = 0; i < ticks; i++) {
    step(m, []);
    views.push(commanderView(m, 'nato'));
  }
  return views;
}

describe('Contacts', () => {
  it('an enemy a friendly Soldier sees is a Contact: position and facing only', () => {
    // nato id 0 faces east; pact id 1 stands 100 m east facing away; nobody fires
    const [v] = play(scene({ 0: { x: 0, y: 0 }, 1: { x: 100, y: 0, fx: 1 } }, { tune: { fireRangeM: 0 } }), 1);
    expect(v!.contacts).toEqual([{ id: 1, x: 100, y: 0, fx: 1, fy: 0 }]);
  });

  it('an enemy no friendly Soldier sees is not', () => {
    const behind = play(scene({ 0: { x: 0, y: 0 }, 1: { x: -100, y: 0, fx: 1 } }), HZ); // behind nato, which faces east
    const walled = play(scene({ 0: { x: 0, y: 0 }, 1: { x: 100, y: 0 } }, { map: { walls: [{ x0: 50, y0: -5, x1: 51, y1: 5 }] } }), HZ);
    const far = play(scene({ 0: { x: 0, y: 0 }, 1: { x: 155, y: 0 } }), HZ);
    const atHome = play(scene({}), HZ); // both Squads at their HQs
    for (const views of [behind, walled, far, atHome]) expect(views.flatMap((v) => v.contacts)).toEqual([]);
  });
});
