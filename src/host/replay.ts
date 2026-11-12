// Replays a Match record headlessly, the way the worker runs it, for the cross-browser determinism test (#32).
import { createMatch, stateHash, step } from '../sim/index';
import { DEFAULT_TUNE } from '../sim/tune';
import { TEST_FIELD } from '../maps/test-field';
import type { MapData } from '../sim/types';
import type { MatchRecord } from './protocol';

/** The state hash after each of the first `ticks` ticks on `map`; a Command stamped tick t is applied on the step run at tick t. */
export function replayHashes(record: MatchRecord, ticks: number, map: MapData = TEST_FIELD): string[] {
  const m = createMatch({ ...record, map, tune: DEFAULT_TUNE });
  const hashes: string[] = [];
  for (let t = 0; t < ticks; t++) {
    step(m, record.log.filter((c) => c.tick === t));
    hashes.push(stateHash(m));
  }
  return hashes;
}

/** Fixed seed and Command log: four Squads a side meet, fight and take points within the two minutes. */
export const REPLAY_RECORD: MatchRecord = {
  seed: 42,
  squadsPerSide: 4,
  commanderSide: 'nato',
  map: TEST_FIELD.name,
  log: [
    { tick: 10, side: 'nato', kind: 'order', squad: 0, point: 'B' },
    { tick: 200, side: 'nato', kind: 'asset', asset: 'scan', at: { x: 0, y: 0 } },
  ],
};

/** #150: on the real Auental bake: eight Squads a side ride out, take the rear and approach flags and fight within the two minutes. */
export const AUENTAL_RECORD: MatchRecord = {
  seed: 42,
  squadsPerSide: 8,
  commanderSide: 'nato',
  map: 'Auental',
  log: [
    { tick: 10, side: 'nato', kind: 'order', squad: 0, point: 'C' },
    { tick: 600, side: 'nato', kind: 'asset', asset: 'scan', at: { x: -300, y: 400 } },
  ],
};

export const REPLAY_TICKS = 120 * DEFAULT_TUNE.hz;
