import type { Command, CommanderView, MapData, SideId, SimEvent } from '../sim/types';

/** A Command before the Sim host stamps it with the tick it applies on. */
export type UnstampedCommand = Command extends infer C ? (C extends Command ? Omit<C, 'tick'> : never) : never;

export type ToHost =
  | { kind: 'start'; seed: number; squadsPerSide: number; commanderSide: SideId }
  | { kind: 'command'; command: UnstampedCommand };

export type FromHost =
  | { kind: 'started'; map: MapData; hz: number; view: CommanderView }
  | { kind: 'view'; view: CommanderView; events: SimEvent[] };
