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
    { id: 'A', name: 'A', x: 0, y: 200, vehicles: [{ kind: 'jeep', x: 0, y: 200 }] },
    { id: 'B', name: 'B', x: 0, y: 0 },
    { id: 'C', name: 'C', x: 0, y: -200, vehicles: [{ kind: 'jeep', x: 0, y: -200 }] },
  ],
  grid: { cols: 8, rows: 8, squareM: 75, letters: 'ABCDEFGH' },
  // #154: a tank, two jeeps, a helicopter, a jet and an AA a Side, in a row 9 m apart from the HQ
  vehicleSlots: {
    nato: [{ kind: 'tank', x: -277, y: 0 }, { kind: 'jeep', x: -268, y: 0 }, { kind: 'jeep', x: -259, y: 0 }, { kind: 'aa', x: -232, y: 0 }],
    pact: [{ kind: 'tank', x: 277, y: 0 }, { kind: 'jeep', x: 268, y: 0 }, { kind: 'jeep', x: 259, y: 0 }, { kind: 'aa', x: 232, y: 0 }],
  },
  helipad: { nato: [{ x: -250, y: 0 }], pact: [{ x: 250, y: 0 }] },
  jets: { nato: 1, pact: 1 },
};
