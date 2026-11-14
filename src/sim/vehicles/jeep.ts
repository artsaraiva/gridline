// #108: the jeep, a transport a Squad rides together: its second seat fires an MG, its passengers get out by the shared rule.
import type { VehicleRules } from './core';
import { groundMove, head } from './ground';
import { goalOf } from './seats';

export const jeep: VehicleRules<'jeep'> = {
  move: groundMove,
  goal: (m, sq, s) => goalOf(m, sq, s), // a transport's driver always drives to its own goal
  onGoal: (m, v, goal) => void (goal >= 0 && head(m, v, goal)), // with none it keeps going where it was
};
