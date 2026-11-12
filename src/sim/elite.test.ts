// Elite Squads (#153): at 12 Squads per Side only the first `eliteSquads` (8) of each Side are on the Commander's net.
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, gridRef, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command, MapData, SideId, SimEvent, Tune } from './types';

const HZ = DEFAULT_TUNE.hz;
const SQUADS = 12;
const SIZE = DEFAULT_TUNE.squadSize;
const GRID = { cols: 12, rows: 12, squareM: 100, letters: 'ABCDEFGHIJKL' };

/** Open ground 1200 m across, HQs on the flanks, B neutral in the middle. */
const field: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -560, y: 0 }, pact: { x: 560, y: 0 } },
  points: [
    { id: 'A', name: 'A', x: -250, y: 250 },
    { id: 'B', name: 'B', x: 0, y: 0 },
    { id: 'C', name: 'C', x: 250, y: -250 },
  ],
  grid: GRID,
};

const scene = (tune: Partial<Tune> = {}): Match =>
  createMatch({ seed: 3, map: field, tune: { ...DEFAULT_TUNE, jetsPerSide: 0, aasPerSide: 0, ...tune }, squadsPerSide: SQUADS, commanderSide: 'nato' });

/** Squad ids run nato first: nato's are 0..11, pact's 12..23; the first 8 of each are Elite. */
const isElite = (id: number) => id % SQUADS < DEFAULT_TUNE.eliteSquads;

const order = (m: Match, side: SideId, squad: number): Command => ({ tick: m.tick, side, kind: 'order', squad, point: 'C' });
const radio = (events: SimEvent[]) => events.filter((e): e is Extract<SimEvent, { kind: 'radio' }> => e.kind === 'radio');

describe('Elite Squads', () => {
  it('an Order to a Side\'s ninth Squad is rejected as not elite; one to its eighth is taken', () => {
    const m = scene();
    const events = step(m, [order(m, 'nato', 8), order(m, 'nato', 7), order(m, 'pact', 20), order(m, 'pact', 19)]);
    const rejected = events.filter((e) => e.kind === 'rejected');
    expect(rejected.map((e) => [e.command.kind === 'order' && e.command.squad, e.reason])).toEqual([
      [8, 'not elite'],
      [20, 'not elite'],
    ]);
    const C = m.points.findIndex((p) => p.id === 'C');
    expect([8, 20].map((id) => m.squads[id]!.pending)).toEqual([null, null]);
    expect([7, 19].map((id) => m.squads[id]!.pending?.point)).toEqual([C, C]);
  });

  it('the view lists each Side\'s 8 Elite Squads, Alpha to Hotel, and every Soldier of the Side as a friendly', () => {
    const m = scene();
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
    for (const [side, first] of [['nato', 0], ['pact', SQUADS]] as const) {
      const v = commanderView(m, side);
      expect(v.squads.map((q) => [q.id, q.name])).toEqual(names.map((n, i) => [first + i, n]));
      expect(v.friendlies).toHaveLength(SQUADS * SIZE);
    }
  });

  it('over a match, only Elite Squads talk on the radio or hold a Request, while the others fight', () => {
    const m = scene();
    const events: SimEvent[] = [];
    let asked = false;
    for (let i = 0; i < 100 * HZ; i++) {
      events.push(...step(m, []));
      asked ||= m.squads.some((sq) => !isElite(sq.id) && sq.request);
    }
    expect(asked).toBe(false);
    const lines = radio(events);
    expect(lines.filter((e) => e.squad !== null && !isElite(e.squad))).toEqual([]);
    expect(lines.some((e) => e.squad !== null && isElite(e.squad))).toBe(true);
    // the Squads that are not Elite were in the fight: one of their Soldiers went down, so they would have called Man down
    expect(events.some((e) => (e.kind === 'wounded' || e.kind === 'death') && !isElite(m.soldiers[e.id]!.squad))).toBe(true);
  });

  it('a point taken only by a Squad that is not Elite is reported once on the Side net; an Elite Squad reports its own', () => {
    const take = (squad: number) => {
      const m = scene({ walkSpeed: 0, visionM: 0, tanksPerSide: 0, jeepsPerSide: 0, helisPerSide: 0, pointJeeps: false });
      for (let i = 0; i < SIZE; i++) Object.assign(m.soldiers[squad * SIZE + i]!, { x: i * 2, y: 0 });
      const events: SimEvent[] = [];
      for (let i = 0; i < (DEFAULT_TUNE.captureSeconds + 10) * HZ; i++) events.push(...step(m, []));
      expect(m.points[1]!.owner).toBe('nato');
      return radio(events).filter((e) => e.side === 'nato' && e.type === 'captured');
    };
    expect(take(8)).toEqual([{ kind: 'radio', side: 'nato', squad: null, type: 'captured', text: 'Bravo captured', grid: gridRef(GRID, { x: 0, y: 0 }), priority: 1 }]);
    expect(take(7).map((e) => e.squad)).toEqual([7]);
  });
});
