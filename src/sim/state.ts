// Internal state the rule modules share, plus the tiny helpers every one of them uses. Not part of the public surface.
import type { Match } from './index';
import type { Sighting } from './memory';
import type { Order, Pending } from './orders';
import type { Request } from './requests';
import type { SideId, SoldierState, Tune, Vec2 } from './types';
import type { Vehicle } from './vehicles';

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
  strayUntil: number; // #93 tick its stray ends; 0 = in the wedge
  slot: number; // seeded scale of its wedge slot
  blocked: number; // ticks it has been stuck
  // #106 Detached Soldiers
  detached: boolean; // away from its Squad on its own goal; out of the wedge, leash, regroup, bounding and flanking
  goal: number; // Detached: index of its own Capture Point, -1 = the Squad's goal
  commitUntil: number; // #120: tick its Commitment to `goal` ends
  // #107 Tank tracer
  vehicle: number; // id of the vehicle it rides in, -1 = on foot
  rockets: number; // Launcher rockets left (only roster member 1 fires them)
  // #108 Jeep: a transport passenger's way out
  exited: number; // id of the vehicle it last got out of, -1 = none; it never boards that one again while anyone rides it
  away: number; // aboard: the drive metres from its vehicle to its own Capture Point at its last think, -1 = not yet measured
  awaySince: number; // aboard: tick that distance began to grow, -1 = it is not growing
  // #55 Commander Score
  cause: 'barrage' | 'missile' | null; // what an enemy Strike did to it: scores for the enemy Commander on death; cleared by Revive
  uavUntil: number; // #75 last tick it counts as UAV-discovered by the enemy Side (the Scan found it unseen, then the grace); see assets/scan.ts
  // #121 Staggered set-off
  reaction: number; // seconds it holds before moving off after its Squad's change, seeded
  holdUntil: number; // tick it may move off; taking fire clears it
  // #122 Boarding
  boarding: number; // id of the vehicle its Squad claimed for it and it is walking to, -1 = none
  climbAt: number; // tick it has climbed in, once within `mountM`; 0 = not climbing
  // #129 Helicopter crew
  crew: boolean; // walking to a helicopter's pilot or gun seat, or in it, for a stint
  crewUntil: number; // tick its stint ends (drawn as it climbs in), -1 = none
  crewSeat: number; // the seat (0 pilot, 1 left gun, 2 right gun) it was sent for, -1 = none
  chute: Chute | null; // #130 a parachute descent
  uavAssist: boolean; // #75 the shot that downed it landed while UAV-discovered: scores for the enemy Commander on death; cleared by Revive
}

/** #130: a parachute descent: the ticks it starts and ends, where it jumped and where it lands. */
export interface Chute {
  t0: number;
  t1: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
  crossed: boolean; // #151: its leader has reached the middle of the route's crossing (or is otherwise over); it walks the point's field
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
  // #73 Ordered capture
  taking: number; // index of the Capture Point it is contributing to taking, -1 = none; see capture.ts
  takingSince: number; // tick it began
  // #120 Traits, drawn once from the Match RNG
  pointPref: number[]; // seeded preference per Capture Point, added to its score
  aggression: number; // [-1, 1]: bold pushes enemy points and falls back later
  commitUntil: number; // tick its Commitment to `goal` ends
  // #121 Think tempo
  thinkInterval: number; // seconds between its thinks, seeded
  nextThink: number; // tick of its next think
  // #122 Boarding
  rideM: number; // a goal farther than this from its foot leader makes it ride, if a vehicle fits; seeded
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

/** `seconds` as whole ticks, at least one: a delay is never zero ticks. */
export const ticksOf = (t: Tune, seconds: number) => Math.max(1, Math.round(seconds * t.hz));
export const membersOf = (m: Match, sq: Squad) => sq.members.map((id) => m.soldiers[id]!);
/** The first living member on foot and not Detached, whom the wedge forms on; the first living member when there is none. */
export const footLeader = (alive: Soldier[]) => alive.find((s) => !s.detached && s.vehicle < 0) ?? alive[0];
/** #107: the vehicle with id `id` (vehicle ids follow the Soldiers'), or undefined for a Soldier id or -1. */
export const vehicleOf = (m: Match, id: number): Vehicle | undefined => (id >= m.soldiers.length ? m.vehicles[id - m.soldiers.length] : undefined);
/** #110: `s` flies a jet: off at its base or in the sky, never where its Squad leads, comes back or asks from. */
export const inJet = (m: Match, s: Soldier) => vehicleOf(m, s.vehicle)?.kind === 'jet';
export const wiped = (members: Soldier[]) => members.every((s) => s.state === 'dead');
export const lastDeath = (members: Soldier[]) => Math.max(...members.map((s) => s.deadAt));

const SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

/** The call sign of `sq`: Alpha, Bravo... in the order of its Side's Squads. */
export const squadName = (m: Match, sq: Squad) => {
  const i = m.squads.filter((o) => o.side === sq.side).indexOf(sq);
  return SQUAD_NAMES[i] ?? `Squad ${i + 1}`;
};

/** #153: per Squad id, whether it is an Elite Squad, one of its Side's first `eliteSquads`: the only Squads on the Commander's net. */
export function elite(m: Match): boolean[] {
  const before: Record<SideId, number> = { nato: 0, pact: 0 };
  return m.squads.map((sq) => before[sq.side]++ < m.tune.eliteSquads);
}

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
    mix(s.cause === 'barrage' ? 1 : s.cause === 'missile' ? 2 : 0);
    mix(s.uavUntil); // #75
    mix(+s.uavAssist);
    mix(s.vehicle); // #107
    mix(s.rockets);
    mix(s.exited); // #108
    mix(Math.round(s.away * 1000));
    mix(s.awaySince);
    mix(Math.round(s.reaction * 1000)); // #121
    mix(s.holdUntil);
    mix(s.boarding); // #122
    mix(s.climbAt);
    mix(+s.crew); // #129
    mix(s.crewUntil);
    mix(s.crewSeat);
    if (s.chute) for (const n of [s.chute.t0, s.chute.t1, Math.round(s.chute.x0 * 1000), Math.round(s.chute.y0 * 1000), Math.round(s.chute.x1 * 1000), Math.round(s.chute.y1 * 1000)]) mix(n); // #130
    else mix(-1);
  }
}

/** Every Squad field that changes during a Match. A new Squad field is mixed in here. */
export function hashSquads(m: Match, mix: Mix) {
  for (const sq of m.squads) {
    mix(sq.goal);
    mix(sq.lastSeen);
    mix(sq.lastHit);
    mix(sq.taking + 1); // #73
    mix(sq.takingSince);
    mix(sq.commitUntil);
    mix(Math.round(sq.thinkInterval * 1000)); // #121
    mix(sq.nextThink);
    for (const p of sq.pointPref) mix(Math.round(p * 1000));
    mix(Math.round(sq.aggression * 1000));
    mix(Math.round(sq.rideM * 1000)); // #122
  }
}
