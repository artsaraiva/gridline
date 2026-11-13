import type { AssetKind, Vec2 } from '../../sim/types';

/** Fixed Asset calls for the DEV review scene on Kaltenbach. */
export const ASSETS: { asset: AssetKind; at: Vec2; to?: Vec2 }[] = [
  { asset: 'scan', at: { x: 120, y: 120 } },
  { asset: 'supply', at: { x: -120, y: 120 } },
  { asset: 'barrage', at: { x: 50, y: -50 } },
  { asset: 'gunship', at: { x: 0, y: 0 } }, // #101: its focus on C; one at a time (asset-review.ts)
  { asset: 'smoke', at: { x: -60, y: -40 }, to: { x: -60, y: 20 } }, // #138: a wall running north; one at a time, as it outlasts the cycle
  { asset: 'creep', at: { x: -110, y: -120 }, to: { x: 10, y: -120 } }, // #138: marching east
  { asset: 'drone', at: { x: -150, y: 60 } }, // #139: 6 s out from the HQ; one at a time, as the Simulation has it
  { asset: 'recon', at: { x: 60, y: 0 }, to: { x: 60, y: 100 } }, // #139: a pass north, east of the centre
];

/** Time between Asset re-calls so Barrage, Scan and Supply Drop stay visible together. */
export const CYCLE_SECONDS = 14;
