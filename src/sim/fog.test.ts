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

describe('Last Known Positions', () => {
  // Two Squads of 1 a Side: nato 0, 1 and pact 2, 3. nato 0 faces east and sees pact 2, 100 m east and facing away, out
  // of fire range. pact 3, 50 m behind nato 0, Wounds it on tick 0, so from tick 1 nobody on nato's Side sees pact 2.
  const lost = () =>
    scene(
      { 0: { x: 0, y: 0 }, 2: { x: 100, y: 0, fx: 1 }, 3: { x: -50, y: 0, fx: 1 } },
      { tune: { hp: 100, hitChance: 1, damage: [100, 100], fireRangeM: 60 }, squads: 2 },
    );

  it('a lost Contact freezes where it was last seen, with no facing, and fades out over 3.5 s', () => {
    const views = play(lost(), 5 * HZ);
    expect(views[0]!.contacts.map((c) => c.id)).toEqual([2]);
    expect(views[0]!.lastKnown).toEqual([]);
    const shown = views.slice(1).filter((v) => v.lastKnown!.length > 0);
    expect(shown).toHaveLength(3.5 * HZ);
    expect(views.slice(1, 1 + shown.length)).toEqual(shown); // from the tick it was lost, without a gap
    for (const v of shown) {
      expect(v.contacts).toEqual([]);
      expect(Object.keys(v.lastKnown![0]!).sort()).toEqual(['fade', 'x', 'y']);
      expect(v.lastKnown![0]).toMatchObject({ x: 100, y: 0 });
    }
    const fades = shown.map((v) => v.lastKnown![0]!.fade);
    expect(fades[0]).toBeCloseTo(1, 1);
    expect(fades.at(-1)).toBeCloseTo(0, 1);
    expect(fades.every((f, i) => i === 0 || f < fades[i - 1]!)).toBe(true);
  });
});
