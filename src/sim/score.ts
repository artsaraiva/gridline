// Commander Score (#55): each Side's per-category totals, and the award that adds to them. Recognition only, never spent.
// Who earned what is attributed by the rule that caused it (combat.ts for a Barrage kill or UAV assist, capture.ts for an
// ordered capture; assets/supply.ts adds its fractions to the ledger every tick and tells the Console as recipients stop
// drawing); this module keeps the ledger.
import type { Match } from './index';
import type { Mix } from './state';
import { SIDES, type CommanderView, type ScoreCategory, type SideId, type SimEvent } from './types';

export const CATEGORIES: readonly ScoreCategory[] = ['uav', 'supply', 'artillery', 'orders'];

export type Score = Record<SideId, Record<ScoreCategory, number>>;

export const newScore = (): Score => ({ nato: { uav: 0, supply: 0, artillery: 0, orders: 0 }, pact: { uav: 0, supply: 0, artillery: 0, orders: 0 } });

/** Adds `points` to `side`'s `category` and tells its Console why. `reason` never names a position or an unseen enemy. */
export function award(m: Match, side: SideId, category: ScoreCategory, points: number, reason: string, events: SimEvent[]) {
  m.score[side][category] += points;
  events.push({ kind: 'award', side, category, points, reason });
}

export function scoreView(m: Match, side: SideId): NonNullable<CommanderView['score']> {
  const s = m.score[side];
  return { total: s.uav + s.supply + s.artillery + s.orders, ...s };
}

export function hashScore(m: Match, mix: Mix) {
  for (const side of SIDES) for (const c of CATEGORIES) mix(Math.round(m.score[side][c] * 1000));
}
