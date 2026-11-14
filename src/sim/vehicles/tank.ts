// #107: the tank, the tracer for the shared Vehicle rules: crewed by its driver (who fires the main gun) and a gunner on the coax.
import type { VehicleRules } from './core';
import { groundMove } from './ground';

export const tank: VehicleRules<'tank'> = {
  move: groundMove,
};
