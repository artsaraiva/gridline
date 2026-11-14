// #110: the AA, a ground vehicle crewed alone like a tank: the Capture Point its driver lays back on (`aaPoint`).
import type { Match } from '../index';
import { dist2, keystone } from '../geometry';
import { enemyOf, type Vec2 } from '../types';
import { live, type Vehicle } from './body';
import type { VehicleRules } from './core';
import { groundMove, head } from './ground';

/** #154: what another friendly AA laying back on a flank takes off each point on that flank, in the metres `aaPoint` scores in: more than the gap between Auental's two rear flags with both preferences against it. */
const AA_SPREAD_M = 300;

/**
 * #110: the Capture Point an AA's driver lays back on: its Side's own, never a keystone one (#150), the nearer its HQ and the farther out
 * on a flank (off the line between the HQs) the better, with the driver's seeded preference; #154 less on a flank another
 * friendly AA is heading for, so two spread over both. -1 with none (it holds where it is, at first in the HQ park).
 */
export function aaPoint(m: Match, v: Vehicle): number {
  const own = m.map.hqs[v.side];
  const foe = m.map.hqs[enemyOf(v.side)];
  const [ax, ay] = [foe.x - own.x, foe.y - own.y];
  const len = Math.sqrt(ax * ax + ay * ay) || 1;
  const off = (p: Vec2) => ((p.x - own.x) * ay - (p.y - own.y) * ax) / len; // out on a flank, signed by which one
  const keys = keystone(m);
  // #154 counts another AA against its flag; it counts here against the flag's whole flank, since on Auental F scores as well as
  // B and a count per flag would send both AAs south
  const flanksTaken = m.vehicles.filter((o) => o !== v && o.kind === 'aa' && o.side === v.side && live(o) && o.seats[0]! >= 0 && o.goal >= 0).map((o) => off(m.points[o.goal]!));
  let best = -1;
  let top = -Infinity;
  m.points.forEach((p, i) => {
    if (p.owner !== v.side || keys.includes(p)) return;
    const flank = off(p);
    const penalty = AA_SPREAD_M * flanksTaken.filter((f) => f * flank > 0).length;
    const score = Math.abs(flank) - Math.sqrt(dist2(p, own)) / 2 + (v.bias[i] ?? 0) * 100 - penalty; // ponytail: a metre out on a flank counts as two back toward the HQ, the preference in hundreds of metres; tune keys if the AA needs placing finer
    if (score > top) [best, top] = [i, score];
  });
  return best;
}

export const aa: VehicleRules<'aa'> = {
  move: groundMove,
  goal: (m, _sq, _s, v) => aaPoint(m, v), // lays back, whatever its Squad's goal
  onGoal: head, // with no rear point left it stops where it is
};
