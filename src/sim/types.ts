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
  hz: number;
  squadSize: number;
  walkSpeed: number; // m/s
  speedJitter: number; // ± fraction of walkSpeed, seeded per Soldier
  spread: number; // ± metres around the Squad's goal, seeded per Soldier
  thinkSeconds: number; // how often a Squad re-picks its Capture Point
  captureRadius: number;
  captureSeconds: number; // per stage: enemy to neutral, neutral to owned
  captureBonusPerExtra: number;
  captureMaxMultiplier: number;
  pointValue: { neutral: number; enemy: number; ownedThreatened: number; ownedQuiet: number };
  distancePenaltyPer100m: number;
  crowdPenalty: number;
  stickiness: number;
  tickets: number;
  drainSeconds: number[]; // index = point lead - 1; leads past the end use the last entry
  matchSeconds: number;
  hqRadius: number; // the enemy never enters or targets inside it
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
  bleedOutSeconds: number;
  reviveSeconds: number;
  reviveRangeM: number;
  reviveReachM: number; // how close the reviver must be to work
  reviveHp: number;
  respawnSeconds: number;
  respawnBehindM: number; // a Squad Respawn lands this far behind the first living member
  quietSeconds: number; // no enemy seen for this long (and nobody suppressed) before a Squad Respawn
  redeploySeconds: number;
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

/** A friendly Squad. */
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

export interface CommanderView {
  side: SideId;
  tick: number;
  seconds: number;
  friendlies: FriendlyView[];
  contacts: SoldierView[]; // no fog yet: every living enemy Soldier
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
  | { kind: 'redeploy'; side: SideId; squad: number; x: number; y: number };
