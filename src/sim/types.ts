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

/** Metres, origin at map centre, x east, y north. */
export interface MapData {
  name: string;
  playArea: Vec2[];
  /** `radius` defaults to `tune.hqRadius`. */
  hqs: Record<SideId, Vec2 & { radius?: number }>;
  /** `radius` defaults to `tune.captureRadius`; `owner` is the Side holding the point at the start. */
  points: { id: string; name: string; x: number; y: number; radius?: number; owner?: SideId | null }[];
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
  thinkSeconds: number; // how often a Squad re-picks its Capture Point

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
  drainSeconds: number[]; // index = point lead - 1; leads past the end use the last entry
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

  // Each ticket appends its keys under its own heading below, so parallel tickets do not touch the same lines.

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
  orderBonus: number; // added to the score of the Squad's ordered point
  orderAckMinSeconds: number; // a Squad acknowledges (and starts on) an Order after a seeded lag between these
  orderAckMaxSeconds: number;

  // #37 Assets: core and Scan
  scanCooldownSeconds: number; // from the call; Scan is ready at match start
  scanSeconds: number; // the UAV circles its spot this long
  scanRadiusM: number; // it reveals every enemy this close to its spot

  // #38 Radio

  // #39 Supply crate

  // #40 Barrage

  // #41 Requests
}

export type Command =
  | { tick: number; side: SideId; kind: 'order'; squad: number; point: string | null }
  | { tick: number; side: SideId; kind: 'asset'; asset: 'scan' | 'supply' | 'barrage'; at: Vec2 };

export type AssetKind = Extract<Command, { kind: 'asset' }>['asset'];

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
}

export type SoldierState = 'alive' | 'wounded' | 'dead';

/** A friendly Soldier; dead ones are left out. */
export interface FriendlyView extends SoldierView {
  squad: number;
  state: Exclude<SoldierState, 'dead'>;
  suppressed: boolean;
  /** #34: rounds left, as a fraction of a full load. */
  ammo?: number;
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
}

export interface AssetView {
  asset: AssetKind;
  /** Seconds until it can be called again; 0 = ready. */
  readyIn: number;
  /** The full cooldown in seconds, for a draining bar. */
  cooldown: number;
  /** Metres around the spot it acts on, for the preview ring. */
  radius: number;
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
   * A higher `priority` pre-empts a lower one; #38 sets the scale.
   */
  | { kind: 'radio'; side: SideId; squad: number | null; type: string; text: string; grid?: string; priority: number }
  /** #34: suppressive fire: a round at (x, y) near a Last Known Position, with no enemy in view. */
  | { kind: 'suppressive'; side: SideId; from: number; x: number; y: number; hit: boolean };
