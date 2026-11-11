import type { Tune } from './types';

export const DEFAULT_TUNE: Tune = {
  // Match and movement
  hz: 20,
  squadSize: 4,
  walkSpeed: 5.06, // 4.4 until the visual round 2 review: the game felt slow, +15 %
  speedJitter: 0.1,
  spread: 8,

  // Capture Points
  captureRadius: 25,
  captureSeconds: 20,
  captureBonusPerExtra: 0.5,
  captureMaxMultiplier: 3,

  // Squad point choice
  pointValue: { neutral: 1.1, enemy: 1.0, ownedThreatened: 0.95, ownedQuiet: -2 }, // quiet owned was 0.35: Squads sat on points nothing happened at (#107 review); now they always go for one that needs them
  distancePenaltyPer100m: 0.17,
  crowdPenalty: 0.4,
  stickiness: 0.2,

  // Tickets, match length, HQ
  tickets: 150,
  drainSeconds: [6, 4, 2.5, 1.75, 1.25], // seconds per Ticket by point lead 1..5; retuned on Kaltenbach (#42): [8, 5, 3] ran 18 min; this runs ~15 min
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
  takingFireSeconds: 3,
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

  // Each ticket appends its keys under its own heading below, so parallel tickets do not touch the same lines. A spec's tracer
  // ticket may add the whole spec's keys under the spec's heading, so its sibling tickets touch none.

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

  // #93 Squad mates stray
  strayChance: 0.1,
  straySeconds: [8, 20],
  strayM: [10, 30],

  // #36 Orders
  orderBonus: 1.5,
  orderAckMinSeconds: 1,
  orderAckMaxSeconds: 2,

  // #37 Assets: core and Scan
  scanCooldownSeconds: 60,
  scanSeconds: 15,
  scanRadiusM: 60,

  // #38 Radio
  radioGapSeconds: 3,
  radioRepeatSeconds: 15,
  radioQuietSeconds: 10,

  // #39 Supply crate
  supplyCooldownSeconds: 90,
  supplyFallSeconds: 5,
  supplyStaySeconds: 60,
  supplyRadiusM: 10,
  supplyHealPerSecond: 3,

  // #40 Barrage
  barrageCooldownSeconds: 120,
  barrageWarningSeconds: 10,
  barrageShells: 6,
  barrageSpanSeconds: 5,
  barrageFlightSeconds: 4,
  barrageSpreadM: 25,
  barrageKillM: 5,
  barrageWoundM: 8,
  barrageSuppressM: 15,
  barrageSuppression: 0.9,
  barrageContactSeconds: 2,

  // #41 Requests
  requestSeconds: 30,
  requestGapSeconds: 15,
  requestCloseM: 75,

  // #55 Commander Score
  scoreArtilleryKill: 100,
  scoreUavAssist: 50,
  scoreOrderedCapture: 200,
  scoreSupplyPerFraction: 10,
  scoreSupplyCapPerRecipient: 30,
  scoreUavGraceSeconds: 5,

  // #99 Cruise Missile
  missileCooldownSeconds: 240,
  missileSpeedMps: 70,
  missileKillM: 12,
  missileWoundM: 20,
  missileSuppressM: 35,
  missileSuppression: 1,
  missileGated: true,

  // #106 Detached Soldiers
  detachM: 80,
  rejoinM: 22,
  squadPull: 0.6,

  // #107 Tank tracer
  vehicleRespawnSeconds: 60,
  boardMinM: 150,
  boardM: 40,
  sameWayM: 150,
  boardWaitSeconds: 8,
  vehicleVisionMul: 1.5,
  hullM: 3,
  tankRoadMps: 8,
  tankOpenMps: 5,
  tankHp: 100,
  tankFireSeconds: 6,
  tankRangeM: 200,
  tankKillM: 4,
  tankWoundM: 7,
  tankSuppressM: 12,
  tankSuppression: 0.9,
  tankVsVehicleDamage: 50,
  tankShellMps: 154,
  tankAimSeconds: [1, 3],
  tankGoalBias: 0.7,
  tanksPerSide: null,
  coaxFireSeconds: 0.15,
  coaxRangeM: 160,
  rockets: 2,
  rocketSeconds: 4,
  rocketRangeM: 100,
  rocketDamage: 35,
  shellVehicleDamage: 35,

  // #108 Jeep
  jeepsPerSide: 2,
  pointJeeps: true,
  jeepRoadMps: 15,
  jeepOpenMps: 9,
  jeepHp: 60,
  mgFireSeconds: 0.12,
  mgRangeM: 160,
  dismountM: 40,
  stillSeconds: 5,
  awaySeconds: 10,
  dismountStopSeconds: 1,

  // #123 Ground-vehicle momentum
  tankAccel: 2,
  jeepAccel: 4,
  brakeMul: 2,
  tankTurnDegPerS: 45,
  jeepTurnDegPerS: 90,
  turnSpeedMin: 0.35,

  // #109 Transport helicopter
  helisPerSide: 1,
  heliMps: 30,
  heliHp: 120,
  unloadSeconds: 3,
  airVisionM: 250,

  // #124 Helicopter flight and Landing Zone
  lzM: [40, 120],
  lzThreatM: 200,
  lzSpreadDeg: 60,
  doglegFraction: [0.15, 0.3],
  doglegMinM: 150,
  heliThreatM: 60,
  heliAccel: 6,
  heliTurnDegPerS: 60,
  flareSeconds: 1,
  spoolSeconds: 1.5,

  // #120 Squad Traits and point choice
  squadGoalBias: 0.5,
  choiceMargin: 0.3,
  commitSeconds: [15, 45],
  commitThreatM: 250,
  aggressionValueMul: 0.25,
  aggressionRetreatMul: 0.3,

  // #121 Think tempo and staggered set-off
  thinkIntervalSeconds: [0.8, 1.5],
  thinkJitter: 0.15,
  reactionSeconds: [0.2, 0.8],

  // #122 Boarding as an action
  rideM: [120, 250],
  heliFitM: 350,
  mountM: 3,
  mountSeconds: [1, 2],

  // #129 Helicopter crew and side guns
  crewSeconds: [60, 180],
  crewSpawnChance: 0.5,
  gunArcDeg: 120,

  // #130 Parachute jump
  chuteSeconds: 4, // #130: the spec said 5; 20-seed Kaltenbach went pact 15 to 5, 4 gives 11 to 9
  chuteScatterM: 15,

  // #131 Helicopter jobs
  orbitM: 100,
  orbitMps: 15,
  orbitSeconds: 12,
  heliRepairBelow: 0.5,
  heliRepairHpPerS: 4,
  crashSeconds: 3,

  // #110 Jet and AA
  jetsPerSide: 1,
  jetHp: 100,
  jetTurnDegPerS: 40,
  jetMps: 120,
  jetFireM: 200,
  jetFireSeconds: 0.1,
  jetStripM: 15,
  jetVsVehicleDamage: 20,
  jetTurnSeconds: 20,
  jetPasses: 4,
  jetRearmSeconds: 90,
  jetBombs: 2,
  jetBombGroup: 3,
  jetBombGroupM: 20,
  jetBombFallSeconds: 1.5,
  jetBombScatterM: 8,
  jetBombKillM: 8,
  jetBombWoundM: 14,
  jetBombSuppressM: 30,
  jetBombVehicleDamage: 60,
  jetDogfightM: 800,
  jetDogfightSeconds: 40,
  jetGunDeg: 16,
  jetVsJetDamage: 8,
  jetLockDeg: 50,
  jetLockSeconds: 1,
  jetMissileRangeM: 500,
  jetReloadSeconds: 10,
  aasPerSide: 1,
  aaHp: 100,
  aaRoadMps: 7,
  aaOpenMps: 4,
  aaRangeM: 300,
  aaGroundRangeM: 200,
  aaFireSeconds: 0.08,
  aaBurstSeconds: [0.8, 1.6],
  aaPauseSeconds: [0.6, 1.4],
  aaHitChance: 0.35,
  aaRoundDamage: 2.5,
  aaLockSeconds: 1.5,
  aaReloadSeconds: 8,
  airMissileMps: 160,
  airMissileTurnDegPerS: 60,
  airMissileSeconds: 5,
  airMissileHitChance: 0.7,
  airMissileVsJetHitChance: 0.5,
  airMissileDamage: 45,

  // #101 Gunship
  gunshipCooldownSeconds: 300,
  gunshipOrbitM: 200,
  gunshipRangeM: 200,
  gunshipSpeedMps: 60,
  gunshipStationSeconds: 45,
  gunshipShotSeconds: 4,
  gunshipShellFlightSeconds: 3,
  gunshipScatterM: 8,
  gunshipHp: 150,
  paradropChance: 0.5,
};
