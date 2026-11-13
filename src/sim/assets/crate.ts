// Where the Supply Drop crates are (#142: and the Redeploy Beacons). Kept apart from supply.ts and beacon.ts so the Squad AI and
// respawn.ts can ask without importing the Asset core (a cycle).
import type { Match } from '../index';
import { insideCount } from '../capture';
import { dist2 } from '../geometry';
import { enemyOf } from '../types';
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

/** #142: how long a Redeploy Beacon stays live once it has landed. */
export const beaconTicks = (m: Match) => Math.round(m.tune.beaconSeconds * m.tune.hz);

/** #142: `side`'s Redeploy Beacon once it has landed, or null (one per Side). */
export const liveBeacon = (m: Match, side: Effect['side']): Effect | null =>
  m.assets.effects.find((e) => e.asset === 'beacon' && e.side === side && e.until - m.tick <= beaconTicks(m)) ?? null;

/** #142: a living enemy Soldier stands within `beaconDenyM` of the beacon, so it is silent (counted as a Capture Point counts). */
export const beaconDenied = (m: Match, e: Effect) => insideCount(m, { x: e.x, y: e.y, radius: m.tune.beaconDenyM }, enemyOf(e.side)) > 0;
