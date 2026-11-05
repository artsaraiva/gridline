// Where the Supply Drop crates are. Kept apart from supply.ts so the Squad AI can ask without importing the Asset core (a cycle).
import type { Match } from '../index';
import { dist2 } from '../geometry';
import type { Effect } from './core';

export const stayTicks = (m: Match) => Math.round(m.tune.supplyStaySeconds * m.tune.hz);

/** Landed: the stay has begun. */
export const landed = (m: Match, e: Effect) => e.until - m.tick <= stayTicks(m);

/** The landed crate of `side` nearest to `p`, or null. */
export function nearestCrate(m: Match, side: Effect['side'], p: { x: number; y: number }): Effect | null {
  let best: Effect | null = null;
  for (const e of m.assets.effects) if (e.asset === 'supply' && e.side === side && landed(m, e) && (!best || dist2(e, p) < dist2(best, p))) best = e;
  return best;
}
