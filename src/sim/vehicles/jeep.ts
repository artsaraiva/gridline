// #108: the jeep, a transport a Squad rides together: its second seat fires an MG, its passengers get out by the shared rule.
import type { Match } from '../index';
import type { Soldier, Squad } from '../state';
import type { VehicleRules } from './core';
import { groundMove, head, setsOff } from './ground';
import { coax, goalOf, inReach } from './seats';

/** #108: a transport's driver always drives to its own goal. */
const goal = (m: Match, sq: Squad, s: Soldier) => goalOf(m, sq, s);

export const jeep: VehicleRules<'jeep'> = {
  move: groundMove,
  goal,
  onGoal: (m, v, goal) => void (goal >= 0 && head(m, v, goal)), // with none it keeps going where it was
  onDriver: setsOff(goal),
  rides: { fits: (m, _sq, L, v) => inReach(m, L, v) },
  seatFire: coax, // #108: its gunner's MG
};
