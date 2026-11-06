// Internal state the rule modules share, plus the tiny helpers every one of them uses. Not part of the public surface.
import type { Match } from './index';
import type { Sighting } from './memory';
import type { Order, Pending } from './orders';
import type { Request } from './requests';
import type { SideId, SoldierState, Tune, Vec2 } from './types';

export interface Soldier {
  id: number;
  side: SideId;
  squad: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
  speed: number; // m per tick
  ox: number; // seeded offset from the Squad's goal
  oy: number;
  state: SoldierState;
  hp: number;
  suppression: number; // suppression 0..1
  target: number; // id of the enemy in view it engages, -1 = none
  nextFire: number; // tick
  bleed: number; // Wounded: ticks left before bleeding out
  revive: number; // Wounded: ticks of revive work done on them
  reviving: number; // id of the Wounded squad mate it is reviving, -1 = none
  deadAt: number; // tick
  // #34 Squad AI
  ammo: number; // rounds left
  lastTarget: number; // last enemy it engaged, kept until its Squad next thinks; -1 = none
  dest: Vec2 | null; // where its Squad sent it (cover, a bound, a regroup spot); null = follow the Squad
  path: Vec2[]; // waypoints to `dest` round obstacles, nearest first
  cover: Vec2 | null; // cover it runs to when pinned in the open; outranks `dest`
  chaseUntil: number; // tick a peel-off chase ends; 0 = not chasing
  role: 'flank' | 'support' | null; // its part in a flank
  regroup: boolean; // walking back to the leader
  slot: number; // seeded scale of its wedge slot
  blocked: number; // ticks it has been stuck
  // #55 Commander Score
  cause: 'barrage' | null; // what an enemy Asset did to it: scores for the enemy Commander on death; cleared by Revive
}

export interface Squad {
  id: number;
  side: SideId;
  members: number[];
  goal: number; // index of the Capture Point it is heading for, -1 = not picked yet
  lastSeen: number; // tick a member last saw an enemy
  lastHit: number; // tick a member was last shot at, or suppressive fire landed near one
  memory: Sighting[]; // this Squad's own sightings, one per enemy id; see memory.ts
  // #34 Squad AI
  task: 'none' | 'point' | 'retreat' | 'resupply'; // `goal` is its Capture Point (-1 = the HQ)
  mode: 'travel' | 'bound' | 'hold' | 'fallback';
  route: number; // index into map.crossings of the crossing it takes to its goal, -1 = none
  slow: boolean; // the leader waits for stragglers
  phase: number; // which bounding pair moves
  phaseUntil: number; // tick
  holdAt: number; // tick holding Soldiers next re-pick cover
  holdOct: number; // octant of the threat when they last did
  flankSign: number; // +1 left, -1 right, 0 = not flanking
  flankSince: number; // tick, -1 = not flanking
  flankDone: boolean; // one flank per contact
  // #36 Orders
  order: Order | null; // the standing Order; see orders.ts
  pending: Pending | null; // an Order sent and not yet acknowledged
  // #41 Requests
  request: Request | null; // its open Request; see requests.ts
  requestNext: number; // first tick it may ask again
}

export interface Point {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  owner: SideId | null;
  progress: number; // -stageTicks (pact) .. +stageTicks (nato)
}

/** Feeds one integer into the running state hash. */
export type Mix = (v: number) => void;

export const sign = (s: SideId) => (s === 'nato' ? 1 : -1);
export const sideOf = (n: number): SideId => (n > 0 ? 'nato' : 'pact');
export const stageTicks = (t: Tune) => t.captureSeconds * t.hz;
export const membersOf = (m: Match, sq: Squad) => sq.members.map((id) => m.soldiers[id]!);
export const wiped = (members: Soldier[]) => members.every((s) => s.state === 'dead');
export const lastDeath = (members: Soldier[]) => Math.max(...members.map((s) => s.deadAt));

const SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

/** The call sign of `sq`: Alpha, Bravo... in the order of its Side's Squads. */
export const squadName = (m: Match, sq: Squad) => {
  const i = m.squads.filter((o) => o.side === sq.side).indexOf(sq);
  return SQUAD_NAMES[i] ?? `Squad ${i + 1}`;
};

/** A Capture Point's letter spoken as its call sign (A = Alpha); any other name as written. */
export const callName = (name: string) => (name.length === 1 && SQUAD_NAMES.find((n) => n[0] === name)) || name;

const STATE = { alive: 0, wounded: 1, dead: 2 };

/** Every Soldier field that changes during a Match, bar the AI fields (hashed in ai/index.ts hashAi). A new Soldier field is mixed in here. */
export function hashSoldiers(m: Match, mix: Mix) {
  for (const s of m.soldiers) {
    mix(Math.round(s.x * 1000));
    mix(Math.round(s.y * 1000));
    mix(Math.round(s.fx * 1000));
    mix(Math.round(s.fy * 1000));
    mix(STATE[s.state]);
    mix(Math.round(s.hp * 1000));
    mix(Math.round(s.suppression * 1000));
    mix(s.target);
    mix(s.nextFire);
    mix(s.bleed);
    mix(s.revive);
    mix(s.reviving);
    mix(s.deadAt);
    mix(s.ammo);
    mix(s.cause === 'barrage' ? 1 : 0);
  }
}

/** Every Squad field that changes during a Match. A new Squad field is mixed in here. */
export function hashSquads(m: Match, mix: Mix) {
  for (const sq of m.squads) {
    mix(sq.goal);
    mix(sq.lastSeen);
    mix(sq.lastHit);
  }
}
