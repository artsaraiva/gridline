export type SideId = 'nato' | 'pact';
export const SIDES: readonly SideId[] = ['nato', 'pact'];

export interface Vec2 {
  x: number;
  y: number;
}

/** Metres, origin at map centre, x east, y north. */
export interface MapData {
  name: string;
  playArea: Vec2[];
  hqs: Record<SideId, Vec2>;
  points: { id: string; name: string; x: number; y: number; radius?: number }[];
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
}

export type Command =
  | { tick: number; side: SideId; kind: 'order'; squad: number; point: string | null }
  | { tick: number; side: SideId; kind: 'asset'; asset: 'scan' | 'supply' | 'barrage'; at: Vec2 };

export interface MatchResult {
  winner: SideId | null; // null = draw
  reason: 'tickets' | 'time';
}

/** A friendly Soldier, or an enemy one shown as a Contact. */
export interface SoldierView {
  id: number;
  x: number;
  y: number;
  /** Unit facing vector. */
  fx: number;
  fy: number;
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
  friendlies: SoldierView[];
  contacts: SoldierView[]; // no fog yet: every enemy Soldier
  points: PointView[];
  tickets: Record<SideId, number>;
  result: MatchResult | null;
}

export type SimEvent = never; // ponytail: no events until radio/combat land
