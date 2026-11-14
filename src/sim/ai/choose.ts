// #183: the choices a Squad's members make that a vehicle's driver makes too, a leaf below the Squad layer (squad.ts) so that the
// vehicle rules use them without importing it: which Capture Point to take (`bestPoint`, with `threatened`) and when a Soldier
// sets off (`reactAt`).
import type { Match } from '../index';
import { insideCount } from '../capture';
import { isDummy } from '../assets/crate';
import { dist2 } from '../geometry';
import { sideKnown } from '../memory';
import { pickWeighted } from '../rng';
import type { Point, Soldier, Squad } from '../state';
import { enemyOf, type Vec2 } from '../types';
import { flowDist, pointFlow, type Flow } from './flow';

const sq2 = (r: number) => r * r;

/**
 * An enemy inside the point, or known to the Side (#133) near it. #143: never a Feint's dummy going off by it: the Feint does not move
 * which point a Squad takes (a lure that drew enemy Squads to it was dropped, #149).
 */
export const threatened = (m: Match, sq: Squad, p: Point) => insideCount(m, p, enemyOf(sq.side)) > 0 || sideKnown(m, sq.side).some((c) => !isDummy(m, c.id) && dist2(c, p) < sq2(p.radius + m.tune.threatenedM));

/** #121: the tick `s` sets off, after its own reaction from now. */
export const reactAt = (m: Match, s: Soldier) => m.tick + Math.round(s.reaction * m.tune.hz);

/**
 * The Capture Point seen from `from` that the Squad takes, -1 = none: value by owner (enemy points x its aggression), path
 * distance, crowding (pairing up on enemy points), its seeded preference, stickiness plus `pull` on the Squad's goal, the
 * Order's bonus. #120: it draws among the points within `choiceMargin` of the best, weighted by how far each clears best minus
 * the margin. #107: a driver scores by `flow` (its drive grid) and adds its own `bias` per point, and takes the best.
 */
export function bestPoint(m: Match, sq: Squad, from: Vec2, pull = 0, own: { flow?: (i: number) => Flow; bias?: number[]; dist?: (i: number) => number } = {}): number {
  const t = m.tune;
  const foe = enemyOf(sq.side);
  const scores: number[] = [];
  m.points.forEach((p, i) => {
    let v =
      p.owner === null ? t.pointValue.neutral
      : p.owner === foe ? t.pointValue.enemy * (own.flow ? 1 : 1 + sq.aggression * t.aggressionValueMul)
      : threatened(m, sq, p) ? t.pointValue.ownedThreatened
      : t.pointValue.ownedQuiet;
    v -= (t.distancePenaltyPer100m * (own.dist?.(i) ?? flowDist(m, (own.flow ?? ((k) => pointFlow(m, k)))(i), from))) / 100; // #110: the jet's, straight-line
    v += own.bias?.[i] ?? (own.flow ? 0 : sq.pointPref[i] ?? 0);
    const others = m.squads.filter((o) => o !== sq && o.side === sq.side && o.task === 'point' && o.goal === i).length;
    v -= p.owner === foe ? (others === 1 ? -t.pairUp : t.crowdPenalty * Math.max(0, others - 1)) : t.crowdPenalty * others;
    if (sq.task === 'point' && sq.goal === i) v += t.stickiness + pull;
    if (sq.order?.point === i) v += t.orderBonus;
    scores.push(v);
  });
  const top = Math.max(...scores);
  if (own.flow || !scores.length) return scores.indexOf(top);
  const floor = top - t.choiceMargin;
  const weights = scores.map((v) => Math.max(0, v - floor));
  const pick = pickWeighted(m, weights);
  return pick < 0 ? scores.indexOf(top) : pick;
}
