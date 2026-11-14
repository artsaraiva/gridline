// #108: the jeep, a transport a Squad rides together: its second seat fires an MG, its passengers get out by the shared rule.
import type { VehicleRules } from './core';
import { groundMove } from './ground';

export const jeep: VehicleRules<'jeep'> = {
  move: groundMove,
};
