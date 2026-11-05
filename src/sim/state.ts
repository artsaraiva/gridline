// Internal state the rule modules share, plus the tiny helpers every one of them uses. Not part of the public surface.
import type { Match } from './index';
import type { Sighting } from './memory';
import type { SideId, SoldierState, Tune } from './types';

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
}

export interface Squad {
  id: number;
  side: SideId;
  members: number[];
  goal: number; // index of the Capture Point it is heading for, -1 = not picked yet
  lastSeen: number; // tick a member last saw an enemy
  memory: Sighting[]; // this Squad's own sightings, one per enemy id; see memory.ts
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

const STATE = { alive: 0, wounded: 1, dead: 2 };

/** Every Soldier field that changes during a Match. A new Soldier field is mixed in here. */
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
  }
}

/** Every Squad field that changes during a Match. A new Squad field is mixed in here. */
export function hashSquads(m: Match, mix: Mix) {
  for (const sq of m.squads) {
    mix(sq.goal);
    mix(sq.lastSeen);
  }
}
