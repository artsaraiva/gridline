import type { Tune } from './types';

export const DEFAULT_TUNE: Tune = {
  // Match and movement
  hz: 20,
  squadSize: 4,
  walkSpeed: 4.4,
  speedJitter: 0.1,
  spread: 8,
  thinkSeconds: 1,

  // Capture Points
  captureRadius: 25,
  captureSeconds: 20,
  captureBonusPerExtra: 0.5,
  captureMaxMultiplier: 3,

  // Squad point choice
  pointValue: { neutral: 1.1, enemy: 1.0, ownedThreatened: 0.95, ownedQuiet: 0.35 },
  distancePenaltyPer100m: 0.17,
  crowdPenalty: 0.4,
  stickiness: 0.2,

  // Tickets, match length, HQ
  tickets: 150,
  drainSeconds: [8, 5, 3],
  matchSeconds: 25 * 60,
  hqRadius: 35,

  // Sight and fire
  cellM: 2,
  visionM: 150,
  visionCos: -0.3,
  fireRangeM: 140,
  hitChance: 0.22,
  fireSeconds: 0.35,
  fireJitterSeconds: 0.15,
  hp: 100,
  damage: [20, 35],
  coverHitMul: 0.5,
  suppressPerShot: 0.2, // single rounds: the sandbox's 0.08 was per round of a 3-round burst
  suppressDecayPerSecond: 0.24,
  suppressAccuracyLoss: 0.55,
  suppressedAt: 0.15,
  pinnedAt: 0.6,

  // Casualties
  bleedOutSeconds: 8,
  reviveSeconds: 3,
  reviveRangeM: 40,
  reviveReachM: 1.8,
  reviveHp: 35,

  // Squad Respawn and Redeploy
  respawnSeconds: 10,
  respawnBehindM: 4,
  quietSeconds: 5,
  redeploySeconds: 20,

  // Each ticket appends its keys under its own heading below, so parallel tickets do not touch the same lines.

  // #34 Squad AI: movement, routes, cover, fire model, ammo
  pairUp: 0.15,
  threatenedM: 40,
  contactSeconds: 3,
  routeSeenM: 60,
  routeSeenRadiusM: 80,
  routeSeenSeconds: 15,
  routeLossM: 50,
  routeLossRadiusM: 50,
  routeLossSeconds: 120,
  routeMateM: 80,
  routeJitterM: 50,
  routeMaxDetourM: 150,
  wedgeBackM: 6,
  wedgeSideM: 5,
  coverRadiusM: 24,
  coverSpacingM: 5,
  leashM: 60,
  boundSeconds: 7,
  peelRangeM: 60,
  peelSeconds: 12,
  flankRangeM: 130,
  flankSeconds: 20,
  flankCos: 0.5,
  suppressiveSeconds: 4,
  suppressiveMinAmmo: 40,
  suppressiveScatterM: 3,
  suppressiveRadiusM: 6,
  suppressiveSuppressMul: 0.6,
  suppressiveHitMul: 0.3,
  retreatSuppression: 0.7,
  ammo: 210,
  ammoLow: 30,
  ammoRefilled: 0.6,
  holdLeashMul: 1.5,
  holdRepickSeconds: 8,

  // #35 Fog of war: memory, Last Known Positions
  memorySeconds: 8,
  lkpSeconds: 3.5,
  hearM: 90,

  // #36 Orders

  // #37 Assets: core and Scan

  // #38 Radio

  // #39 Supply crate

  // #40 Barrage

  // #41 Requests
};
