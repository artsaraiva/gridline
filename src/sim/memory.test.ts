import { describe, expect, it } from 'vitest';
import { createMatch } from './index';
import type { MapData } from './types';
import { sideKnown } from './memory';
import { DEFAULT_TUNE } from './tune';

const map: MapData = {
  name: 'field',
  playArea: [
    { x: -600, y: -600 },
    { x: 600, y: -600 },
    { x: 600, y: 600 },
    { x: -600, y: 600 },
  ],
  hqs: { nato: { x: -500, y: 0 }, pact: { x: 500, y: 0 } },
  points: [],
};

describe('sideKnown: what any Squad of a Side knows', () => {
  it("is the union of its Squads' memory, the freshest entry per enemy id and source, and never the other Side's", () => {
    const m = createMatch({ seed: 1, map, tune: { ...DEFAULT_TUNE, squadSize: 2 }, squadsPerSide: 2, commanderSide: 'nato' });
    const [a, b] = m.squads.filter((q) => q.side === 'nato');
    const pact = m.squads.find((q) => q.side === 'pact')!;
    a!.memory.push({ id: 100, x: 1, y: 1, tick: 5, source: 'seen' }, { id: 101, x: 2, y: 2, tick: 5, source: 'seen' });
    b!.memory.push({ id: 100, x: 9, y: 9, tick: 8, source: 'heard' });
    pact.memory.push({ id: 102, x: 3, y: 3, tick: 9, source: 'seen' });
    const known = sideKnown(m, 'nato');
    expect([...new Set(known.map((e) => e.id))].sort()).toEqual([100, 101]);
    expect(known.find((e) => e.id === 100 && e.source === 'heard')).toMatchObject({ x: 9, y: 9, tick: 8 });
  });

  it('keeps the freshest entry per enemy and source: a newer heard does not hide an older seen', () => {
    const m = createMatch({ seed: 1, map, tune: { ...DEFAULT_TUNE, squadSize: 2 }, squadsPerSide: 2, commanderSide: 'nato' });
    const [a, b] = m.squads.filter((q) => q.side === 'nato');
    a!.memory.push({ id: 100, x: 1, y: 1, tick: 5, source: 'seen' });
    b!.memory.push({ id: 100, x: 9, y: 9, tick: 8, source: 'heard' });
    expect(sideKnown(m, 'nato').map((e) => e.source).sort()).toEqual(['heard', 'seen']);
  });
});
