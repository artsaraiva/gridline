// #183: what a Soldier forgets when Wounded or brought back, a leaf so that the damage rules (damage.ts) use it without importing
// the Squad layer.
import type { Match } from '../index';

/** What a Soldier forgets when Wounded or brought back. */
export const resetSoldierAi = (m: Match) => ({
  ammo: m.tune.ammo, lastTarget: -1, dest: null, path: [], cover: null, chaseUntil: 0, role: null, regroup: false, strayUntil: 0, detached: false, goal: -1, commitUntil: 0, boarding: -1, climbAt: 0, crew: false, crewUntil: -1, crewSeat: -1,
});
