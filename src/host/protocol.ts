import type { Command, CommanderView, MapData, SideId, SimEvent } from '../sim/types';

/** A Command before the Sim host stamps it with the tick it applies on. */
export type UnstampedCommand = Command extends infer C ? (C extends Command ? Omit<C, 'tick'> : never) : never;

export type MatchSetup = { seed: number; squadsPerSide: number; commanderSide: SideId };

/** Everything needed to replay a match: its setup, the map it ran on and every stamped Command. */
export type MatchRecord = MatchSetup & { map: string; log: Command[] };

export type ToHost =
  | ({ kind: 'start' } & MatchSetup)
  | { kind: 'command'; command: UnstampedCommand };

export type FromHost =
  | { kind: 'started'; map: MapData; hz: number; view: CommanderView }
  | { kind: 'view'; view: CommanderView; events: SimEvent[]; record?: MatchRecord };
