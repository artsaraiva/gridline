export type SideId = 'nato' | 'pact';
export const SIDES: readonly SideId[] = ['nato', 'pact'];
export const enemyOf = (s: SideId): SideId => (s === 'nato' ? 'pact' : 'nato');

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned box in metres. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The map's Grid Reference squares, centred on the map origin: columns A.. west to east, rows 1.. north to south. */
export interface MapGrid {
  cols: number;
  rows: number;
  squareM: number;
  letters: string;
}

/**
 * A Side's HQ, at its centre. `radius` defaults to `tune.hqRadius`. With an `area` the HQ is that polygon (the centre lies in
 * it) and `radius` only sizes the margins kept round it (jets, vehicles, where a Squad counts as home); without, it is the circle.
 * `spawns` are the spots its Squads start the Match and Redeploy on, each on one no friendly Soldier stands by; unset = the centre.
 */
export type Hq = Vec2 & { radius?: number; area?: Vec2[]; spawns?: Vec2[] };

/** Metres, origin at map centre, x east, y north. */
export interface MapData {
  name: string;
  playArea: Vec2[];
  hqs: Record<SideId, Hq>;
  /**
   * `radius` defaults to `tune.captureRadius`; `owner` is the Side holding the point at the start. #154: `vehicles` wait at the
   * point for whoever owns it (#108), each at its own spot; unset = none.
   */
  points: { id: string; name: string; x: number; y: number; radius?: number; owner?: SideId | null; vehicles?: (Vec2 & { kind: 'tank' | 'jeep' })[] }[];
  /** #150: the ids of the points that make the keystone (both halves of Auental's twin town); unset = the point nearest the centre. */
  keystone?: string[];
  /** Cells that block line of sight. */
  walls?: Rect[];
  /** Cells that make a Soldier standing in them harder to hit. */
  cover?: Rect[];
  /** Grid Reference squares; see `gridRef`. */
  grid?: MapGrid;
  /** #34: Water: nobody walks in it, sight passes over it. */
  water?: Rect[];
  /**
   * #34: Where the water can be crossed: each opens the water within `halfWidth` north and south of (x, y), 30 m east and west
   * (rivers run north-south). A ford is slow going. The `bridge` is the centre's own fight, never avoided as dangerous.
   */
  crossings?: Crossing[];
  /** #42: a baked map's terrain on cells; when present it replaces `walls`, `cover`, `water` and the box rule of `crossings`. */
  terrain?: Terrain;
  /**
   * #107 #154: where each Side's HQ ground vehicles wait and respawn, one vehicle per slot: its count of a kind is its slots of
   * that kind. A vehicle the tune adds past them waits in a row 9 m apart toward the field, past the last slot (without any, from
   * the drivable ground nearest the HQ).
   */
  vehicleSlots?: Partial<Record<SideId, (Vec2 & { kind: 'tank' | 'jeep' | 'aa' })[]>>;
  /** #109 #154: where each Side's transport helicopters wait and respawn, one per pad; one the tune adds past them waits in the row. */
  helipad?: Partial<Record<SideId, Vec2[]>>;
  /** #110 #154: each Side's jets, at its off-map base (`launchPoint`); unset = none. */
  jets?: Partial<Record<SideId, number>>;
}

/**
 * #42: terrain on a cell grid, row-major, row 0 at the south edge (y up). `x0`, `y0` is the south-west corner in metres.
 * `cells` holds 0 open, or WALL / COVER / WATER from grid.ts; `wade` marks fords (slow going); `crossing` is the index into
 * `MapData.crossings` of the crossing the cell belongs to, -1 for none. #107: `drive` is the ground-vehicle cost per cell before the
 * hull margin: road 10, open 20, ford 30, 0 blocked (any wall or building, half a cell of hedge, woods or water; a footbridge);
 * `clear` is the distance from the cell's centre to the nearest 1 m cell of any of those, in decimetres, 255 for 5 m or more.
 */
export interface Terrain {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  cellM: number;
  cells: Uint8Array;
  wade: Uint8Array;
  crossing: Int8Array;
  drive: Uint8Array;
  clear: Uint8Array;
}

export interface Crossing {
  id: string;
  kind: 'bridge' | 'footbridge' | 'ford';
  x: number;
  y: number;
  halfWidth: number;
}

export interface Tune {
  // Match and movement
  hz: number;
  squadSize: number;
  walkSpeed: number; // m/s
  speedJitter: number; // ± fraction of walkSpeed, seeded per Soldier
  spread: number; // ± metres around the Squad's goal, seeded per Soldier

  // Capture Points
  captureRadius: number;
  captureSeconds: number; // per stage: enemy to neutral, neutral to owned
  captureBonusPerExtra: number;
  captureMaxMultiplier: number;

  // Squad point choice
  pointValue: { neutral: number; enemy: number; ownedThreatened: number; ownedQuiet: number };
  distancePenaltyPer100m: number;
  crowdPenalty: number;
  stickiness: number;

  // Tickets, match length, HQ
  tickets: number;
  drainSeconds: number[]; // index = point lead - 1, for leads 1..5
  matchSeconds: number;
  hqRadius: number; // the enemy never enters or targets inside it

  // Sight and fire
  cellM: number; // sight grid cell size
  visionM: number;
  visionCos: number; // cone: an enemy is in view while cos(angle off facing) >= this
  fireRangeM: number;
  hitChance: number;
  fireSeconds: number; // between shots, plus up to fireJitterSeconds, seeded
  fireJitterSeconds: number;
  hp: number;
  damage: [number, number]; // per hit, seeded between the two
  coverHitMul: number; // hit chance multiplier on a target standing in cover
  suppressPerShot: number; // added to the target's suppression (0..1) per shot fired at it
  suppressDecayPerSecond: number;
  suppressAccuracyLoss: number; // hit chance x (1 - this x suppression)
  takingFireSeconds: number; // a Squad is taking fire this long after any member was shot at, or suppressive fire landed near one
  suppressedAt: number; // suppression above this counts as suppressed
  pinnedAt: number; // suppression above this counts as pinned: no reviving

  // Casualties
  bleedOutSeconds: number;
  reviveSeconds: number;
  reviveRangeM: number;
  reviveReachM: number; // how close the reviver must be to work
  reviveHp: number;

  // Squad Respawn and Redeploy
  respawnSeconds: number;
  respawnBehindM: number; // a Squad Respawn lands this far behind the first living member
  quietSeconds: number; // no enemy seen for this long (and nobody suppressed) before a Squad Respawn
  redeploySeconds: number;

  // Each ticket appends its keys under its own heading below, so parallel tickets do not touch the same lines. A spec's tracer
  // ticket may add the whole spec's keys under the spec's heading, so its sibling tickets touch none.

  // #34 Squad AI: movement, routes, cover, fire model, ammo
  pairUp: number; // point score bonus for the second Squad going for the same enemy point
  threatenedM: number; // an owned point is threatened by a remembered enemy within its radius + this
  contactSeconds: number; // a sighting this recent (or a suppressed member) puts the Squad in contact
  routeSeenM: number; // route length added per enemy seen at the crossing ...
  routeSeenRadiusM: number; // ... within this of it ...
  routeSeenSeconds: number; // ... this recently
  routeLossM: number; // route length added per own death at the crossing ...
  routeLossRadiusM: number;
  routeLossSeconds: number;
  routeMateM: number; // route length added per other own Squad taking the crossing to the same point
  routeJitterM: number; // ± seeded route length jitter
  routeMaxDetourM: number; // routes longer than the shortest by more than this are dropped
  wedgeBackM: number; // wedge slots: each pair this far further back ...
  wedgeSideM: number; // ... and this far further out
  coverRadiusM: number; // how far a Soldier under fire looks for cover
  coverSpacingM: number; // cover spots this far from each squad mate
  leashM: number; // past this from the leader a Soldier regroups
  boundSeconds: number; // bounding pairs swap this often
  peelRangeM: number; // a lost target this close may be chased by one healthy Soldier ...
  peelSeconds: number; // ... for at most this long
  flankRangeM: number; // a threat this close is flanked by a Squad of 3 or more
  flankSeconds: number; // a flank ends after this long ...
  flankCos: number; // ... or once a flanker has swung round the threat to cos(angle) below this
  suppressiveSeconds: number; // suppressive fire goes at Last Known Positions this recent
  suppressiveMinAmmo: number; // a Soldier keeps this many rounds back from suppressive fire
  suppressiveScatterM: number; // ± aim scatter round the Last Known Position
  suppressiveRadiusM: number; // enemies this close to the aim point are suppressed
  suppressiveSuppressMul: number; // x suppressPerShot for them
  suppressiveHitMul: number; // x hitChance on the enemy nearest the aim point
  retreatSuppression: number; // more than half the Squad above this falls back
  ammo: number; // rounds carried; one per shot
  ammoLow: number; // more than half the Squad below this goes to the HQ for ammo ...
  ammoRefilled: number; // ... until every member has this fraction of `ammo` back
  holdLeashMul: number; // a holding Squad stays within this x the point radius
  holdRepickSeconds: number; // holding Soldiers re-pick cover this often (or when the threat moves round)

  // #35 Fog of war: memory, Last Known Positions
  memorySeconds: number; // a Squad forgets an enemy it has not seen or heard for this long
  lkpSeconds: number; // a lost Contact shows as a Last Known Position, fading, for this long
  hearM: number; // Soldiers this close to a shooter hear it (the target always does)

  // #36 Orders
  // #93 Squad mates stray
  strayChance: number; // per think, a travelling non-leader member this likely leaves the wedge ...
  straySeconds: [number, number]; // ... for this long (seeded between the two) ...
  strayM: [number, number]; // ... to a spot this far beside the Squad's line ahead (seeded, either side)

  orderBonus: number; // added to the score of the Squad's ordered point
  orderAckMinSeconds: number; // a Squad acknowledges (and starts on) an Order after a seeded lag between these
  orderAckMaxSeconds: number;

  // #37 Assets: core and Scan
  scanCooldownSeconds: number; // from the call; Scan is ready at match start
  scanSeconds: number; // the UAV circles its spot this long
  scanRadiusM: number; // it reveals every enemy this close to its spot

  // #38 Radio
  radioGapSeconds: number; // a Squad sends at most one line this often
  radioRepeatSeconds: number; // the same type of line from the same Squad is dropped for this long
  radioQuietSeconds: number; // a Squad calls Contact only after this long without seeing an enemy

  // #39 Supply crate
  supplyCooldownSeconds: number; // from the call; Supply Drop is ready at match start
  supplyFallSeconds: number; // from the call to the crate landing
  supplyStaySeconds: number; // the landed crate stays this long
  supplyRadiusM: number; // friendly Soldiers this close to a landed crate are refilled and healed
  supplyHealPerSecond: number; // hit points a Soldier in reach gets back each second

  // #40 Barrage
  barrageCooldownSeconds: number; // from the call; the Barrage also starts the match on this cooldown
  barrageWarningSeconds: number; // from the call to the first shell leaving
  barrageShells: number;
  barrageSpanSeconds: number; // from the first shell leaving to the last
  barrageFlightSeconds: number; // a shell is in the air this long before it lands
  barrageSpreadM: number; // shells land within this of the spot, seeded
  barrageKillM: number; // a shell kills within this ...
  barrageWoundM: number; // ... Wounds within this ...
  barrageSuppressM: number; // ... and suppresses within this
  barrageSuppression: number; // suppression (0..1) a shell leaves
  barrageContactSeconds: number; // enemies in the zone are Contacts from the first impact until this long after the last

  // #41 Requests
  requestSeconds: number; // an open Request expires after this long
  requestGapSeconds: number; // a Squad whose Request closed asks again after this long
  requestCloseM: number; // a matching Asset that has landed this close to a Request's grid answers it

  // #55 Commander Score
  scoreArtilleryKill: number; // per enemy a Barrage kills, or Wounds and who then bleeds out
  scoreUavAssist: number; // per enemy killed while UAV-discovered
  scoreOrderedCapture: number; // per Capture Point taken by a Squad under an attack Order
  scoreSupplyPerFraction: number; // x (health fraction + ammo fraction) a Supply Drop restores ...
  scoreSupplyCapPerRecipient: number; // ... capped at this per Soldier per drop
  scoreUavGraceSeconds: number; // a UAV discovery lasts this long after the UAV stops seeing the enemy

  // #99 Cruise Missile
  missileCooldownSeconds: number; // from the call; the missile also starts the match on this cooldown
  missileSpeedMps: number; // level flight from the launch point beyond the own map edge straight to the spot
  missileKillM: number; // the one blast kills within this ...
  missileWoundM: number; // ... Wounds within this ...
  missileSuppressM: number; // ... and suppresses within this (the zone ring)
  missileSuppression: number; // suppression (0..1) the blast leaves
  missileGated: boolean; // the heavy Assets' calls (Cruise Missile, #101 Gunship) need every keystone Capture Point (#150); off for review scenes (`?free=1`)

  // #106 Detached Soldiers
  detachM: number; // a stray that ends farther than this from the foot leader goes Detached instead of regrouping
  rejoinM: number; // a Detached Soldier with the Squad's goal rejoins within this of the foot leader
  squadPull: number; // added to the Squad's goal when a Detached Soldier picks its own Capture Point

  // #107 Tank tracer (and the #27 shared vehicle rules it brings)
  vehicleRespawnSeconds: number; // a destroyed vehicle's fresh one appears in its slot this long after
  boardMinM: number; // a Soldier boards only when its goal is farther than this ...
  boardM: number; // ... from a friendly vehicle with a free seat within this ...
  sameWayM: number; // ... that is empty, or whose driver's goal is within this of its own
  boardWaitSeconds: number; // a driver waits this long from the claim for its Squad's riders, leaving early when all are aboard
  vehicleVisionMul: number; // a ground vehicle sees, and is seen, at this x visionM
  hullM: number; // ground vehicles keep their centre farther than this from anything blocking
  tankRoadMps: number; // on road
  tankOpenMps: number; // off road (a ford is slower in the ratio of its drive cost)
  tankHp: number;
  tankFireSeconds: number; // the driver fires the main gun this often ...
  tankRangeM: number; // ... at a target this close: a Strike-shaped impact that kills within ...
  tankKillM: number;
  tankWoundM: number; // ... Wounds within ...
  tankSuppressM: number; // ... and suppresses within this
  tankSuppression: number;
  tankVsVehicleDamage: number; // an enemy tank's main gun on a vehicle within its kill radius
  tankShellMps: number; // a main gun round flies to the spot at this speed, then lands
  tankAimSeconds: [number, number]; // the main gun fires on a new target this long after it is laid on it (seeded between the two)
  tankGoalBias: number; // ± a fresh driver's seeded preference per Capture Point, in point-score units, kept for its drive
  tanksPerSide: number | null; // #154: tanks in each HQ; null = the map's (one per tank slot); 0 = none
  coaxFireSeconds: number; // the gunner's coax: the rifle shot model this often ...
  coaxRangeM: number; // ... at infantry this close
  rockets: number; // a Launcher (roster member 1 of every Squad) carries this many, refilled like ammo
  rocketSeconds: number; // one rocket this often ...
  rocketRangeM: number; // ... at the nearest enemy vehicle this close, in line of sight ...
  rocketDamage: number; // ... for this much
  shellVehicleDamage: number; // a Barrage shell within its kill radius of the hull; a Cruise Missile destroys outright

  // #108 Jeep (and the #27 passenger rule for every transport)
  jeepsPerSide: number | null; // #154: jeeps in each HQ; null = the map's (one per jeep slot); 0 = none
  pointJeeps: boolean; // #154: the vehicles each Capture Point lists in the map, for whoever owns it; false = none
  jeepRoadMps: number; // on road
  jeepOpenMps: number; // off road
  jeepHp: number; // rifles hit it like a Soldier (no cover), rockets and shells as any vehicle, a tank's main gun destroys it
  mgFireSeconds: number; // the gunner's MG: the rifle shot model this often ...
  mgRangeM: number; // ... at infantry this close
  dismountM: number; // a passenger gets out within this of its own Capture Point ...
  stillSeconds: number; // ... or once the transport has stood still this long away from it ...
  awaySeconds: number; // ... or once its drive distance to it has grown for this long
  dismountStopSeconds: number; // a vehicle stands this long before anyone gets out; nobody bails at speed

  // #123 Ground-vehicle momentum
  tankAccel: number; // m/s² a tank speeds up by ...
  jeepAccel: number; // ... a jeep
  brakeMul: number; // slowing is this many times faster than speeding up
  tankTurnDegPerS: number; // how fast a tank turns its hull toward its way ahead
  jeepTurnDegPerS: number; // ... a jeep
  turnSpeedMin: number; // the share of full speed it wants at a 90° or sharper turn ahead

  // #109 Transport helicopter
  helisPerSide: number | null; // #154: transport helicopters in each HQ; null = the map's (one per helipad); 0 = none
  heliMps: number; // top flight speed, over the ground grid
  heliHp: number; // rifles hit it like a Soldier (airborne or landed), rockets as any vehicle, a tank's main gun destroys it
  unloadSeconds: number; // landed at its passengers' goal, it sits this long before it flies on (or home)
  airVisionM: number; // its eyes: a full circle this far, over walls

  // #124 Helicopter flight and Landing Zone
  lzM: [number, number]; // a Landing Zone lies this far from its goal's centre, seeded between the two
  lzThreatM: number; // enemies its passengers' Squads know within this of the goal push the Landing Zone to the far side
  lzSpreadDeg: number; // the Landing Zone's bearing is seeded this far either way of straight away from them
  doglegFraction: [number, number]; // a trip's waypoint lies this share of the trip's length off the middle of the line, seeded between the two
  doglegMinM: number; // a shorter trip flies straight
  heliThreatM: number; // a dogleg side passing this close to an enemy-held point's radius, or to a known enemy, loses to the other
  heliAccel: number; // m/s² a helicopter speeds up or slows by
  heliTurnDegPerS: number; // how fast it turns toward its way ahead
  flareSeconds: number; // it hovers this long over its Landing Zone (or home slot) before touching down
  spoolSeconds: number; // once it may leave, it spools its rotor this long before lifting off

  // #120 Squad Traits and point choice
  squadGoalBias: number; // ± a Squad's seeded preference per Capture Point, in point-score units, kept for the match
  choiceMargin: number; // a self-chosen pick draws among the points scoring within this of the best, weighted by how far each clears best - margin
  commitSeconds: [number, number]; // a self-chosen point is held this long (seeded between the two) unless an early-pick event ends it
  commitThreatM: number; // an own Capture Point this near the leader that is threatened ends a Commitment
  aggressionValueMul: number; // enemy points are worth x (1 + aggression x this), aggression in [-1, 1]
  aggressionRetreatMul: number; // the Retreat suppression threshold is x (1 + aggression x this), kept below 1

  // #121 Think tempo and staggered set-off
  thinkIntervalSeconds: [number, number]; // #121 a Squad's own think interval, seeded between the two
  thinkJitter: number; // #121 each think lands the interval ± this fraction after the last
  reactionSeconds: [number, number]; // #121 a Soldier's own hold before moving off after its Squad's goal, task or mode changes, seeded between the two

  // #122 Boarding as an action
  rideM: [number, number]; // a Squad rides when its goal is farther than this from its foot leader, seeded between the two per Squad
  heliFitM: number; // the helicopter fits a goal farther than this (or across the river)
  mountM: number; // a rider within this of its vehicle climbs in
  mountSeconds: [number, number]; // a rider takes this long to climb in, seeded between the two

  // #129 Helicopter crew and side guns
  crewSeconds: [number, number]; // a crew member's stint, drawn between the two as they climb in
  crewSpawnChance: number; // a Soldier coming back from the dead takes an empty pilot or gun seat of a helicopter on its helipad with this chance
  gunArcDeg: number; // a side gun covers this many degrees, centred straight out from its side

  // #130 Parachute jump
  chuteSeconds: number; // a Soldier who jumps from a helicopter takes this long to reach the ground
  chuteScatterM: number; // and lands up to this far from where it jumped (seeded)

  // #131 Helicopter jobs
  orbitM: number; // a helicopter circling a point (Support, or over a hot goal) flies this far from its centre
  orbitMps: number; // ... at this speed
  orbitSeconds: number; // over a hot goal it circles this long before its riders jump
  heliRepairBelow: number; // under this share of its hit points it drops its passengers and flies home to repair
  heliRepairHpPerS: number; // on its helipad it regains this many hit points a second until full
  crashSeconds: number; // a helicopter bailed out of glides this long, then crashes and is a Wreck

  // #110 Jet and AA
  jetsPerSide: number | null; // #154: jets per Side, at the off-map base, each taking off with a pilot (at match start, then a Soldier coming back); null = the map's `jets`; 0 = none
  jetHp: number; // only the AA and the enemy jet hurt it
  jetTurnDegPerS: number; // it turns toward where it flies (a mark, home, the enemy jet) this fast; in a dogfight x its pilot's quickness
  jetMps: number; // flight speed, base to point and through every pass
  jetFireM: number; // inbound, the cannon fires from this far short of the point ...
  jetFireSeconds: number; // ... this often (the rifle shot model) ...
  jetStripM: number; // ... at the nearest enemy the Side knows within this of the flight line ahead
  jetVsVehicleDamage: number; // a cannon hit on a vehicle
  jetTurnSeconds: number; // past the Play Area after a pass it turns this long before the next
  jetPasses: number; // passes per sortie ...
  jetRearmSeconds: number; // ... then it rearms this long at the base, its pilot aboard
  jetBombs: number; // bombs per sortie: one a pass whose mark is a vehicle or a group ...
  jetBombGroup: number; // ... of at least this many known enemies ...
  jetBombGroupM: number; // ... within this of the mark
  jetBombFallSeconds: number; // a bomb is released this long short of its mark and lands on it then ...
  jetBombScatterM: number; // ... up to this far off (seeded)
  jetBombKillM: number; // its blast kills within ...
  jetBombWoundM: number; // ... Wounds within ...
  jetBombSuppressM: number; // ... and suppresses within this
  jetBombVehicleDamage: number; // on a ground vehicle within its kill radius
  jetDogfightM: number; // a jet with an enemy jet in the air this close fights it ...
  jetDogfightSeconds: number; // ... for at most this long, or until either is a third down, or the other is this far x 1.5
  jetGunDeg: number; // the cannon fires on the enemy jet within this cone ahead, within jetFireM ...
  jetVsJetDamage: number; // ... for this much a hit
  jetLockDeg: number; // its missile locks on the enemy jet held within this cone ahead, from behind it, ...
  jetLockSeconds: number; // ... for this long ...
  jetMissileRangeM: number; // ... this close; then one missile ...
  jetReloadSeconds: number; // ... and the next this long after
  aasPerSide: number | null; // #154: AAs per Side in its HQ park; null = the map's (one per AA slot); 0 = none
  aaHp: number; // rockets, Barrage shells, a tank's main gun and the jet's cannon hurt it, a Cruise Missile destroys it, rifles nothing
  aaRoadMps: number; // on road
  aaOpenMps: number; // off road
  aaRangeM: number; // it fires on a helicopter (or a jet over the Play Area) this close, over walls, a full circle, first
  aaGroundRangeM: number; // else on infantry or a light vehicle (jeep, landed helicopter) in its sight this close
  aaFireSeconds: number; // a round this often in a burst ...
  aaBurstSeconds: [number, number]; // ... of this long (seeded) ...
  aaPauseSeconds: [number, number]; // ... then a pause this long (seeded)
  aaHitChance: number; // a round hits a vehicle with this chance (infantry: the rifle shot model) ...
  aaRoundDamage: number; // ... for this much
  aaLockSeconds: number; // its missile locks on an air target held this long, then one missile ...
  aaReloadSeconds: number; // ... and the next this long after
  airMissileMps: number; // a lock-on missile (the AA's, or a jet's at another jet) flies this fast ...
  airMissileTurnDegPerS: number; // ... turning after its target this fast ...
  airMissileSeconds: number; // ... for this long at most; close on its target ...
  airMissileHitChance: number; // ... it hits with this chance (seeded), else flies on past ...
  airMissileVsJetHitChance: number; // ... (a jet, jinking and flaring: this chance) ...
  airMissileDamage: number; // ... for this much

  // #152 Tickets and drain scale with points and Squads
  ticketBaseSquads: number; // the Squads per Side `tickets` and `drainSeconds` were tuned at; other counts scale both

  // #153 Elite Squads
  eliteSquads: number; // each Side's first this many Squads are on the Commander's net: Orders, Requests, Callouts, tiles

  // #154 Vehicles for 128 v 128
  jetGapSeconds: [number, number]; // a Side's first jet takes off at match start, each next one this long after the one before (seeded), so no two fly out together

  // #101 Gunship
  gunshipCooldownSeconds: number; // from the call; it also starts the match on this cooldown
  gunshipRangeM: number; // its cannon and its gunner reach this far from the ground spot under it; the enemies on foot in it are Contacts
  gunshipFocusM: number; // the known enemies within this of its focus are flown at first; the ring while the Commander picks the spot
  gunshipSpeedMps: number; // slow: in from the launch point beyond the own map edge, over the enemies its Side knows and home again, level ...
  gunshipTurnDegPerS: number; // ... turning no faster than this: wide arcs
  gunshipStationSeconds: number; // on station this long from the first tick the focus is in reach
  gunshipShotSeconds: number; // one shell this often at the nearest enemy in its range (none: no shot) ...
  gunshipShellFlightSeconds: number; // ... flying this long from the aircraft ...
  gunshipScatterM: number; // ... to within this of where the enemy was; the blast is a Barrage shell's
  gunshipHp: number; // the enemy AA fires on it as on a helicopter; under a third it leaves early, at 0 it falls as a Wreck
  paradropChance: number; // a Soldier coming back takes a passenger seat of its Side's Gunship on station with this chance, when the aircraft is nearer its goal than where it came back

  // Vehicle routes: which crossing, and detours through the fields round known danger (drive-route.ts); danger is weighed in seconds of driving
  driveSeenS: number; // what driving past an enemy the Side saw lately is worth (`routeSeenSeconds`, within `routeSeenRadiusM`)
  driveLossS: number; // ... past where one of its own died lately (`routeLossSeconds`, within `routeLossRadiusM`)
  driveWreckS: number; // ... past an own ground Wreck, as lately and as near
  driveMateS: number; // added per other friendly ground vehicle taking the same crossing to the same point
  driveJitterS: number; // ± seeded jitter on each crossing's score
  driveMaxDetourS: number; // crossings slower than the road's by more than this are dropped
  driveCaution: [number, number]; // a driver planning a detour weighs the danger by a seeded factor between these
  tankOutgunnedPenalty: number; // off a point's score for a tank driver, per enemy tank the Side knows there beyond the friendly tanks going (its own counted)
  tankWreckPenalty: number; // off a point's score for a tank driver, per own tank Wreck there lately (`routeLossSeconds`)
  // #136 Mark
  markMax: number; // live Marks a Side; one more replaces the oldest
  markSeconds: number; // a Mark's life from when it was placed or last renewed
  markClearM: number; // a friendly Soldier this near a Mark, with line of sight to it, checks it
  markClearSeconds: number; // checked this long with no enemy seen within markClearM, the Mark is cleared

  // #138 Smoke Screen
  smokeCooldownSeconds: number; // from the call; ready at match start
  smokeLengthM: number; // the wall runs this far from the first tap towards the second ...
  smokeWidthM: number; // ... and is this thick: each shell's disc is this wide once bloomed
  smokeShells: number; // spaced evenly along the wall
  smokeWarningSeconds: number; // from the call to the first landing
  smokeBloomSeconds: number; // a disc grows to its full width over this long from its landing ...
  smokeHoldSeconds: number; // ... holds it this long ...
  smokeThinSeconds: number; // ... and shrinks to nothing over this long

  // #138 Creeping Barrage
  creepCooldownSeconds: number; // from the call; it also starts the match on this cooldown
  creepLengthM: number; // the strip drawn from the first tap towards the second
  creepShells: number; // one after the other from the start ...
  creepStepSeconds: number; // ... this long apart ...
  creepStepM: number; // ... each this much further along the line ...
  creepScatterM: number; // ... and up to this far off it to either side (seeded)
  creepWarningSeconds: number; // from the call to the first landing
  creepKillM: number;
  creepWoundM: number;
  creepSuppressM: number; // enemies this near a shell that has landed are Contacts for `barrageContactSeconds`
  creepSuppression: number;

  // #139 Drone Strike: a light Strike that flies from the caller's HQ; the enemy AA may shoot it down
  droneCooldownSeconds: number; // from the call; it also starts the match on this cooldown
  droneSpeedMps: number;
  droneKillM: number;
  droneWoundM: number;
  droneSuppressM: number; // the enemies this near the hit are Contacts for `barrageContactSeconds`
  droneSuppression: number;
  droneVehicleDamage: number; // to a tank or an AA in the kill radius; anything lighter on the ground is destroyed
  droneHp: number; // against the AA's rounds and missiles

  // #139 Recon Plane: one pass across the Play Area along a line, revealing a strip under it
  reconCooldownSeconds: number; // from the call; ready at match start
  reconSpeedMps: number;
  reconStripM: number; // enemies this near the aircraft are revealed
  reconHp: number;
}

/** #55: what a Commander Score award is for. */
export type ScoreCategory = 'uav' | 'supply' | 'artillery' | 'orders';

export type Command =
  | { tick: number; side: SideId; kind: 'order'; squad: number; point: string | null }
  | { tick: number; side: SideId; kind: 'asset'; asset: 'scan' | 'supply' | 'barrage' | 'missile' | 'gunship' | 'smoke' | 'creep' | 'drone' | 'recon'; at: Vec2; to?: Vec2 } // #138: `to` is a line-shaped Asset's second tap: its line runs from `at` towards it
  /** #136: no `id` places a Mark at `at`; with `id` it renews that Mark, or clears it when `at` is null. */
  | { tick: number; side: SideId; kind: 'mark'; at: Vec2 | null; id?: number };

export type AssetKind = Extract<Command, { kind: 'asset' }>['asset'];
/** #99: what a Squad may Request: never a Cruise Missile (#58), #101 nor a Gunship, #138 nor a line-shaped Asset. */
export type RequestKind = Exclude<AssetKind, 'missile' | 'gunship' | 'smoke' | 'creep' | 'drone' | 'recon'>; // #139: a Drone Strike answers a Barrage Request and a Recon Plane a Scan one (requests.ts)

export interface MatchResult {
  winner: SideId | null; // null = draw
  reason: 'tickets' | 'time';
}

/** A Soldier's position and facing: all an enemy Contact shows, and the base of a friendly. */
export interface SoldierView {
  id: number;
  x: number;
  y: number;
  /** Unit facing vector. */
  fx: number;
  fy: number;
  /** #130: how far its parachute descent has come, 0..1; absent on the ground. */
  chute?: number;
}

export type SoldierState = 'alive' | 'wounded' | 'dead';

/** A friendly Soldier; dead ones are left out. */
export interface FriendlyView extends SoldierView {
  squad: number;
  state: Exclude<SoldierState, 'dead'>;
  suppressed: boolean;
  /** #34: rounds left, as a fraction of a full load. */
  ammo?: number;
  /** #107: the id of the vehicle it rides in (it is drawn there, not as a Soldier); absent on foot. */
  vehicle?: number;
}

/**
 * #107: a vehicle on the map: the Side's own (live, with `hp` and `seats`), an enemy one a friendly sees right now (position
 * and facing only), or a Wreck (`wreck`, no id: -1).
 */
/** #107 #108: the vehicle classes on the ground; #109 the transport helicopter, in the air; #110 the jet (air) and the AA (ground); #101 the Gunship (air, flown by its Asset); #139 the Drone Strike's drone and the Recon Plane (air, flown by their Assets, nobody aboard). */
export type VehicleKind = 'tank' | 'jeep' | 'helicopter' | 'jet' | 'aa' | 'gunship' | 'drone' | 'recon';

export interface VehicleView {
  id: number;
  side: SideId;
  kind: VehicleKind;
  x: number;
  y: number;
  /** Unit hull facing. */
  fx: number;
  fy: number;
  /** Unit turret facing: at its target, else along the hull. */
  tx: number;
  ty: number;
  wreck?: boolean;
  /** Own only: hit points as a fraction of full. */
  hp?: number;
  /** Own only: Soldier ids in the seats, driver first, -1 free. */
  seats?: number[];
  /** Nobody aboard (it shows as an unmanned vehicle). Absent when someone is. */
  empty?: boolean;
  /** #109: a helicopter in the air (drawn at altitude over its ground shadow), #110 or a jet on a sortie. Absent on the ground (a jet at its off-map base: not drawn). */
  airborne?: boolean;
  /** #110: lock-on missiles it fired, still in flight (an AA's, or a jet's at another jet): where each is and its heading. */
  missiles?: { x: number; y: number; fx: number; fy: number }[];
  /** Main gun rounds in the air (a tank's): from the muzzle spot to where each lands, `flight` 0..1 along. */
  rounds?: { from: Vec2; to: Vec2; flight: number }[];
}

/** A friendly Squad. New fields go in optional (`?`), so view literals in other tickets and tests still typecheck. */
export interface SquadView {
  id: number;
  name: string;
  size: number;
  /** Living (not Wounded) members. */
  strength: number;
  /** Seconds until each dead member may Squad Respawn; 0 = waiting for the Squad to be quiet. Empty when wiped. */
  respawnIn: number[];
  /** Seconds until the wiped Squad Redeploys; null unless wiped. */
  redeployIn: number | null;
  /** Shot at, or near suppressive fire, within `takingFireSeconds`. False when wiped. */
  takingFire?: boolean;
  /** The Capture Point id the wiped Squad would Redeploy at now; null = its HQ. Set only when wiped. */
  redeployAt?: string | null;
  /** #34: what the Squad does on its own: heads for `point`, holds it, falls back to it (or the HQ), or fetches ammo at the HQ. */
  task?: 'move' | 'hold' | 'retreat' | 'resupply' | null;
  /** #34: the Capture Point id of the task; null = the HQ, or no task. */
  point?: string | null;
  /** #34: the crossing id it takes to get there, when the water is in the way. */
  route?: string | null;
  /**
   * #36: the Squad's standing Order, null/absent = none. `pending` until the Squad has acknowledged it (the old Order, if any,
   * still stands until then; a pending clear has `point: null`); then `following` it, `holding` the point (own, or taken),
   * or `delayed` by survival, with its `reason`.
   */
  order?: { point: string | null; state: 'pending' | 'following' | 'delayed' | 'holding'; reason?: 'retreat' | 'resupply' } | null;
  /** #68: the Squad Leader's Soldier id: the first roster member for the whole Match (Wounded still leads); null while they are dead. */
  leader?: number | null;
  /**
   * #41: the Squad's open Request, null/absent = none: the Asset it asks for, the centre of the Grid Reference it names
   * (`at`, null `grid` only on a map without one) and the seconds left before it expires.
   */
  request?: { asset: RequestKind; at: Vec2; grid: string | null; left: number } | null;
}

export interface PointView {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  owner: SideId | null;
  /** -1 = fully pact, 0 = neutral, +1 = fully nato. */
  progress: number;
}

/** Where a lost Contact was last seen: no facing. `fade` runs from 1 (just lost) to 0 (about to go). */
export interface LastKnownView {
  x: number;
  y: number;
  fade: number;
}

/** New fields go in optional (`?`), so view literals in other tickets and tests (summary.test.ts) still typecheck. */
export interface CommanderView {
  side: SideId;
  tick: number;
  seconds: number;
  friendlies: FriendlyView[];
  /** Enemy Soldiers a friendly Soldier sees right now: position and facing only. */
  contacts: SoldierView[];
  /** Lost Contacts, fading out. */
  lastKnown?: LastKnownView[];
  squads: SquadView[];
  points: PointView[];
  tickets: Record<SideId, number>;
  result: MatchResult | null;
  /** The Assets this Side can call; one missing from the list is not in the game yet. */
  assets?: AssetView[];
  /** This Side's Assets at work on the map. */
  effects?: EffectView[];
  /** #55: the Commander Score so far, in all and by category. */
  score?: { total: number } & Record<ScoreCategory, number>;
  /** #107: own vehicles, enemy vehicles in sight, and Wrecks (own, and enemy ones that died in sight). */
  vehicles?: VehicleView[];
  /** #152: each Side's starting Tickets, the same for both; the Ticket bars scale against it. */
  ticketsStart?: number;
  /** #152: seconds per enemy Ticket the point lead drains now; null when level. */
  drainEvery?: number | null;
  /** #136: this Side's Marks, oldest first. */
  marks?: MarkView[];
}

/** #136: a Mark on its own Side's Console; `fade` runs from 1 (just placed or renewed) to 0 (gone). */
export interface MarkView {
  id: number;
  x: number;
  y: number;
  fade: number;
}

export interface AssetView {
  asset: AssetKind;
  /** Seconds until it can be called again; 0 = ready. */
  readyIn: number;
  /** The full cooldown in seconds, for a draining bar. */
  cooldown: number;
  /** Metres around the spot it acts on, for the preview ring. */
  radius: number;
  /** #99: why the row is off (e.g. `needs C` for a point-gated Asset); the cooldown runs regardless. Absent when it can be called. */
  off?: string;
  /** #101: it is at work and a call now moves its spot (the Gunship's focus) whatever `readyIn` says. Absent otherwise. */
  retask?: true;
  /** #138: it is line-shaped: called with two taps, on a strip this long from the first towards the second and this wide. Absent otherwise. #139: `across`: the strip runs through the first tap right across the Play Area and `beyond` metres past each edge, whatever `length` says. */
  line?: { length: number; width: number; across?: true; beyond?: number };
}

export interface EffectView {
  asset: AssetKind;
  x: number;
  y: number;
  radius: number;
  /** Seconds it keeps working. */
  left: number;
  /** Its full working time in seconds. */
  total: number;
  // #39 Supply Drop: the crate falls before it works
  /** Seconds until the crate lands; 0 = on the ground. Only on a crate. */
  landsIn?: number;
  /** How long the fall takes in all, in seconds. Only on a crate. */
  fall?: number;
  /** #40 Barrage: shells in the air, each with where it lands and how far along its flight it is (0..1). #101: a Gunship's with the muzzle spot it left (`from`). */
  shells?: { x: number; y: number; flight: number; from?: Vec2 }[];
  /** #40 Barrage: seconds until the first shell lands; 0 once it has. */
  impactIn?: number;
  // #99 Cruise Missile: in the sky, so in both Sides' views
  /** Who called it. Only on a missile. */
  side?: SideId;
  /** Where it was launched, beyond the Play Area behind the caller's HQ. Only on a missile. */
  from?: Vec2;
  /** How far along its flight it is (0..1); 1 once it has hit. Only on a missile. */
  flight?: number;
  // #101 Gunship: in the sky, so in both Sides' views (with `side`, and `from` its launch point); `x` and `y` are its focus (`radius`: `gunshipFocusM`)
  /** Where it is in its sortie: flying in, on station (hunting, revealing and shelling), or flying home. Absent once shot down. */
  phase?: 'inbound' | 'station' | 'leaving';
  /** The aircraft: the ground spot under it, its unit heading and the way it is turning (1 left, -1 right, 0 straight on). Absent once shot down. */
  craft?: { x: number; y: number; fx: number; fy: number; turn: number };
  // #138 Smoke Screen (in the sky, so in both Sides' views, with `side`) and Creeping Barrage (its shells in flight are in both; the strip only in the caller's)
  /** The strip of a line-shaped Asset: it runs from (`x`, `y`) to `to` and is `width` across. */
  line?: { to: Vec2; width: number };
  /** Smoke Screen: the discs on the ground, each with its radius now, the seconds since its shell landed, and how dense it is (1, falling to 0 as it thins). */
  smoke?: { x: number; y: number; r: number; age: number; density: number }[];
  // #139 Drone Strike and Recon Plane: in the sky, so in both Sides' views, with `side` and `craft` (`turn` 0: they fly straight). The drone's `from` is the HQ it left, its `flight` and `impactIn` as the missile's; the Recon Plane's `line` is its pass, in the caller's view only.
  /** The enemy AA shot it down: `craft` is where it was hit, and nothing more comes of it. Absent otherwise. */
  lost?: true;
}

/** Things that happened this tick, on every Side; `commanderEvents` keeps the ones a Side's Console may show. */
export type SimEvent =
  | { kind: 'shot'; side: SideId; from: number; to: number; hit: boolean }
  | { kind: 'wounded' | 'death' | 'respawn'; side: SideId; id: number; x: number; y: number }
  | { kind: 'revived'; side: SideId; id: number; by: number }
  | { kind: 'redeploy'; side: SideId; squad: number; x: number; y: number }
  /** A Command the Simulation won't carry out. */
  | { kind: 'rejected'; side: SideId; command: Command; reason: string }
  /**
   * A radio line on `side`'s net. #38 owns Callouts, spam control and the log; other tickets send lines of their own `type`
   * (e.g. 'contact', 'ack', 'flanking', 'request'). `squad` is null for a line not from a Squad (HQ, the asset net).
   * `text` is the line without the Grid Reference; `grid` is set when the line is located (see `gridRef`).
   * `priority` is set by radio.ts from the `type` (RADIO_PRIORITY): a higher one pre-empts a waiting lower one. Callouts: 'contact',
   * 'fire', 'mandown', 'capturing', 'captured', 'redeploying', 'clear' (#136: a Mark checked and found empty; the Side net's, `squad` null, for a Squad that is not Elite). Commander-side lines (`squad` null): 'lost' (a Capture Point the Side
   * held, #85), 'captured' (#153: a point only Squads that are not Elite took) and 'wiped' (sent for a Squad that is gone, with its
   * `squad`). Only Elite Squads (#153) send lines of their own.
   */
  | { kind: 'radio'; side: SideId; squad: number | null; type: string; text: string; grid?: string; priority: number }
  /** #34: suppressive fire: a round at (x, y) near a Last Known Position (#136: or a Mark), with no enemy in view. */
  | { kind: 'suppressive'; side: SideId; from: number; x: number; y: number; hit: boolean }
  /** #40: a Barrage shell landed at (x, y); `side` called it. #99: or a Cruise Missile (`asset`), #101 a Gunship's shell. #107: or a tank's main gun, fired by vehicle `from`. */
  | { kind: 'impact'; side: SideId; x: number; y: number; asset: 'barrage' | 'missile' | 'tank' | 'bomb' | 'gunship' | 'creep' | 'drone'; from?: number } // #138: or a Creeping Barrage's shell, #139 a Drone Strike
  /** #55: `side`'s Commander earned `points` of Commander Score. `reason` is safe to show: it never names a position or an unseen enemy. */
  | { kind: 'award'; side: SideId; category: ScoreCategory; points: number; reason: string };
