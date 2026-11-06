// #68 Squad Leader succession. Leadership is an identity only: the AI, combat and Orders never read it, and the
// formation's point man (the first living member) is a separate thing.
import type { Match } from './index';

/**
 * Keeps each Squad's leader while they are not dead (a Wounded leader still leads). Once dead, the first alive (not
 * Wounded) member in roster order takes over; with nobody eligible the Squad has no leader (-1) until someone is. A
 * respawned former leader is not reinstated; a Redeploy ends with the first roster member leading.
 */
export function succession(m: Match) {
  for (const sq of m.squads) {
    if (sq.leader >= 0 && m.soldiers[sq.leader]!.state !== 'dead') continue;
    sq.leader = sq.members.find((id) => m.soldiers[id]!.state === 'alive') ?? -1;
  }
}
