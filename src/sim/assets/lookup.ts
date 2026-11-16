// #182: how a rule reads the Asset effects at work, by kind and typed: every by-kind lookup goes through here. It imports the
// Asset core and the adapters as types only (as crate.ts does), so a rule module, and grid.ts through smoke.ts, can ask without
// loading the Asset core (a cycle).
import type { Match } from '../index';
import type { AssetKind, SideId } from '../types';
import type { EffectOf } from './core';

/** The effects of `kind` at work, `side`'s alone when given, in the order they were called. */
export const effectsOf = <K extends AssetKind>(m: Match, kind: K, side?: SideId): EffectOf<K>[] =>
  m.assets.effects.filter((e): e is EffectOf<K> => e.asset === kind && (side === undefined || e.side === side));
