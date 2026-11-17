// Tune overrides for tests: each switches a ticket's tempo or Traits off so a test can check one rule at a time.
import type { Match } from './index';
import type { GunTune, Tune } from './types';

/** #120: the best point, no Commitment, no aggression, one ride distance (#122). */
export const NO_TRAITS: Partial<Tune> = { squadGoalBias: 0, choiceMargin: 0, commitSeconds: [0, 0], aggressionValueMul: 0, aggressionRetreatMul: 0, rideM: [180, 180] };

/** #121: every Squad thinks each second, with no jitter, and every Soldier sets off at once, as before the tempo rules. */
export const NO_TEMPO: Partial<Tune> = { thinkIntervalSeconds: [1, 1], thinkJitter: 0, reactionSeconds: [0, 0] };

/** #121: each Squad opens on the tick its id sets within its first interval (Squad 0 at once, Squad 1 an interval less a tick on), as before a Match drew it: the tests that read the Squads' first choices expect it. */
export const thinkOnId = (m: Match) => {
  for (const sq of m.squads) {
    const first = Math.round(sq.thinkInterval * m.tune.hz);
    sq.nextThink = (first - (sq.id % first)) % first;
  }
  return m;
};

const PLAIN: GunTune = { rangeMul: 1, burst: [1, 1], gapSeconds: 0, pauseSeconds: [0.35, 0.5], hitMul: 1, damageMul: 1, suppressMul: 1, ammo: 1 };
/** Every gun the plain rifle from before the roster: single rounds at `hitChance` and `fireRangeM`, for a test whose scene needs a certain shot. */
export const PLAIN_GUNS: Pick<Tune, 'guns'> = { guns: { rifle: PLAIN, smg: PLAIN, lmg: PLAIN, dmr: PLAIN, sniper: PLAIN } };
