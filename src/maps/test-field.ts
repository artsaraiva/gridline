import type { MapData } from '../sim/types';

/** Hand-written stand-in for the baked map: open ground, slice layout (#25), no terrain. */
export const TEST_FIELD: MapData = {
  name: 'Test field',
  playArea: [
    { x: -172, y: 298 },
    { x: 298, y: 298 },
    { x: 298, y: -172 },
    { x: 172, y: -298 },
    { x: -298, y: -298 },
    { x: -298, y: 172 },
  ],
  hqs: { nato: { x: -277, y: 0 }, pact: { x: 277, y: 0 } },
  points: [
    { id: 'A', name: 'A', x: 0, y: 200 },
    { id: 'B', name: 'B', x: 0, y: 0 },
    { id: 'C', name: 'C', x: 0, y: -200 },
  ],
  grid: { cols: 8, rows: 8, squareM: 75, letters: 'ABCDEFGH' },
};
