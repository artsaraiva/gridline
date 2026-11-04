import type { Tune } from './types';

export const DEFAULT_TUNE: Tune = {
  hz: 20,
  squadSize: 4,
  walkSpeed: 4.4,
  speedJitter: 0.1,
  spread: 8,
  thinkSeconds: 1,
  captureRadius: 25,
  captureSeconds: 20,
  captureBonusPerExtra: 0.5,
  captureMaxMultiplier: 3,
  pointValue: { neutral: 1.1, enemy: 1.0, ownedThreatened: 0.95, ownedQuiet: 0.35 },
  distancePenaltyPer100m: 0.17,
  crowdPenalty: 0.4,
  stickiness: 0.2,
  tickets: 150,
  drainSeconds: [8, 5, 3],
  matchSeconds: 25 * 60,
};
