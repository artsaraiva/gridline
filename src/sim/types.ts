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

  // #35 Fog of war: memory, Last Known Positions
  memorySeconds: number; // a Squad forgets an enemy it has not seen or heard for this long
  lkpSeconds: number; // a lost Contact shows as a Last Known Position, fading, for this long
  hearM: number; // Soldiers this close to a shooter hear it (the target always does)

  // #36 Orders

  // #37 Assets: core and Scan

  // #38 Radio

  // #39 Supply crate

  // #40 Barrage

  // #41 Requests
}

export type Command =
  | { tick: number; side: SideId; kind: 'order'; squad: number; point: string | null }
  | { tick: number; side: SideId; kind: 'asset'; asset: 'scan' | 'supply' | 'barrage'; at: Vec2 };

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
}

/** Things that happened this tick. No fog filter yet: every Side's events. */
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
  | { kind: 'radio'; side: SideId; squad: number | null; type: string; text: string; grid?: string; priority: number };
