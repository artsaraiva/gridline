import type { AssetKind, Vec2 } from '../../sim/types';

/** Fixed Asset calls for the DEV review scene on Kaltenbach. */
export const ASSETS: { asset: AssetKind; at: Vec2 }[] = [
  { asset: 'scan', at: { x: 120, y: 120 } },
  { asset: 'supply', at: { x: -120, y: 120 } },
  { asset: 'barrage', at: { x: 50, y: -50 } },
];

/** Time between Asset re-calls so Barrage, Scan and Supply Drop stay visible together. */
export const CYCLE_SECONDS = 14;
