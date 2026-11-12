import type { MapData } from '../sim/types';

/**
 * Hand-written test map for route choice: a river runs north-south through the middle, crossed by a footbridge in the north,
 * the bridge in the centre and a ford in the south. Point A is on the nato bank, E on the pact bank, C on the bridge.
 * From the nato HQ, E is 415 m over the footbridge, 441 m over the bridge and 617 m by the ford (A from the pact HQ likewise).
 */
export const RIVER_FIELD: MapData = {
  name: 'River field',
  playArea: [
    { x: -300, y: -200 },
    { x: 300, y: -200 },
    { x: 300, y: 200 },
    { x: -300, y: 200 },
  ],
  hqs: { nato: { x: -280, y: 0 }, pact: { x: 280, y: 0 } },
  points: [
    { id: 'A', name: 'A', x: -100, y: -140, vehicles: [{ kind: 'jeep', x: -100, y: -140 }] },
    { id: 'C', name: 'C', x: 0, y: 0 },
    { id: 'E', name: 'E', x: 100, y: 140, vehicles: [{ kind: 'jeep', x: 100, y: 140 }] },
  ],
  // #154: a tank, two jeeps, a helicopter, a jet and an AA a Side, in a row 9 m apart from the HQ
  vehicleSlots: {
    nato: [{ kind: 'tank', x: -280, y: 0 }, { kind: 'jeep', x: -271, y: 0 }, { kind: 'jeep', x: -262, y: 0 }, { kind: 'aa', x: -235, y: 0 }],
    pact: [{ kind: 'tank', x: 280, y: 0 }, { kind: 'jeep', x: 271, y: 0 }, { kind: 'jeep', x: 262, y: 0 }, { kind: 'aa', x: 235, y: 0 }],
  },
  helipad: { nato: [{ x: -253, y: 0 }], pact: [{ x: 253, y: 0 }] },
  jets: { nato: 1, pact: 1 },
  water: [{ x0: -6, y0: -200, x1: 6, y1: 200 }],
  crossings: [
    { id: 'N', kind: 'footbridge', x: 0, y: 120, halfWidth: 2 },
    { id: 'C', kind: 'bridge', x: 0, y: 0, halfWidth: 4 },
    { id: 'S', kind: 'ford', x: 0, y: -120, halfWidth: 6 },
  ],
  cover: [
    { x0: -30, y0: 100, x1: -20, y1: 104 },
    { x0: 20, y0: -104, x1: 30, y1: -100 },
    { x0: -40, y0: -10, x1: -36, y1: 10 },
    { x0: 36, y0: -10, x1: 40, y1: 10 },
  ],
  walls: [
    { x0: -120, y0: -110, x1: -100, y1: -100 },
    { x0: 100, y0: 100, x1: 120, y1: 110 },
  ],
  grid: { cols: 8, rows: 6, squareM: 75, letters: 'ABCDEFGH' },
};
