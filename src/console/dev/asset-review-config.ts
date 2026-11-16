// The DEV Asset review scene's calls (asset-review.ts), and the views scripts/review-capture.mjs takes by default. Imports
// types only, so the capture script can load it through its own Vite server.
import type { AssetKind, Vec2, VehicleKind } from '../../sim/types';

/** #184: one Asset's call in the review scene, and how `?focus=` frames it. */
export interface ReviewCall {
  at: Vec2;
  /** #138: a line-shaped Asset's second tap. */
  to?: Vec2;
  /** The camera zoom `?focus=` frames it at (8 is close tactical). */
  zoom: number;
  /** Called one at a time: not again while its own effect is up, as it outlasts the cycle, or the Simulation has one at a time. */
  single: boolean;
}

/** Fixed Asset calls for the DEV review scene on Kaltenbach, in call order. #184: total over AssetKind; null for a kind the scene leaves out, with why. */
export const REVIEW: Record<AssetKind, ReviewCall | null> = {
  scan: { at: { x: 120, y: 120 }, zoom: 8, single: false },
  supply: { at: { x: -120, y: 120 }, zoom: 8, single: false },
  barrage: { at: { x: 50, y: -50 }, zoom: 8, single: false },
  missile: null, // reviewed in the commander review timeline (commander-review-timeline.ts), which has the enemy's too
  gunship: { at: { x: 0, y: 0 }, zoom: 1.6, single: true }, // #101: its focus on C, wide for its loops
  smoke: { at: { x: -60, y: -40 }, to: { x: -60, y: 20 }, zoom: 8, single: true }, // #138: a wall running north; it outlasts the cycle
  creep: { at: { x: -110, y: -120 }, to: { x: 10, y: -120 }, zoom: 8, single: false }, // #138: marching east
  drone: { at: { x: -150, y: 60 }, zoom: 3, single: true }, // #139: 6 s out from the HQ, wide enough for its flight in; one at a time, as the Simulation has it
  recon: { at: { x: 60, y: 0 }, to: { x: 60, y: 100 }, zoom: 1.6, single: true }, // #139: a pass north, east of the centre, wide enough for it
  beacon: { at: { x: -60, y: 90 }, zoom: 8, single: false }, // #142: each re-call replaces it, so it falls again every cycle
  rapid: null, // #142: untargeted, it has nothing on the map
  emp: { at: { x: 30, y: 20 }, zoom: 8, single: true }, // #143: by C, where the vehicles go; it outlasts the cycle
  feint: { at: { x: -150, y: -20 }, zoom: 8, single: true }, // #143: west of the cluster, falling again once the last has gone
};

/** #107: the vehicle classes `?focus=` follows, nato's (#108 jeep, #109 helicopter, #110 jet and AA). */
export const VEHICLES: VehicleKind[] = ['tank', 'jeep', 'helicopter', 'jet', 'aa'];

/** Time between Asset re-calls so Barrage, Scan and Supply Drop stay visible together. */
export const CYCLE_SECONDS = 14;
