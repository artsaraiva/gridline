// Squad and Soldier decisions: which Capture Point to go for, and how to walk there.
import type { Match } from './index';
import { insideCount } from './capture';
import { canStand, dist2 } from './geometry';
import { membersOf, type Soldier, type Squad } from './state';
import { enemyOf } from './types';

/** Squad picks the Capture Point with the best score: value by owner, distance, crowding, stickiness. */
export function think(m: Match, sq: Squad) {
  const t = m.tune;
  const leader = membersOf(m, sq).find((s) => s.state === 'alive') ?? m.soldiers[sq.members[0]!]!;
  let best = -1;
  let bestScore = -Infinity;
  m.points.forEach((p, i) => {
    const value =
      p.owner === null ? t.pointValue.neutral
      : p.owner !== sq.side ? t.pointValue.enemy
      : insideCount(m, p, enemyOf(sq.side)) > 0 ? t.pointValue.ownedThreatened
      : t.pointValue.ownedQuiet;
    const others = m.squads.filter((o) => o !== sq && o.side === sq.side && o.goal === i).length;
    const score =
      value -
      (t.distancePenaltyPer100m * Math.sqrt(dist2(p, leader))) / 100 -
      t.crowdPenalty * others +
      (sq.goal === i ? t.stickiness : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  sq.goal = best;
}

/** Walks toward the Wounded squad mate it is reviving, else toward its Squad's goal. Faces its target if it has one. */
export function walk(m: Match, s: Soldier) {
  const t = m.tune;
  const w = m.soldiers[s.reviving];
  const p = m.points[m.squads[s.squad]!.goal];
  let dx: number;
  let dy: number;
  if (w) {
    if (dist2(s, w) <= t.reviveReachM * t.reviveReachM) return;
    dx = w.x - s.x;
    dy = w.y - s.y;
  } else if (p) {
    dx = p.x + s.ox - s.x;
    dy = p.y + s.oy - s.y;
  } else return;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.01) return;
  const v = Math.min(s.speed, d);
  const x = s.x + (dx / d) * v;
  const y = s.y + (dy / d) * v;
  // blocked: slide along whichever axis is free, else stand
  if (canStand(m, s, { x, y })) Object.assign(s, { x, y });
  else if (canStand(m, s, { x, y: s.y })) s.x = x;
  else if (canStand(m, s, { x: s.x, y })) s.y = y;
  if (s.target >= 0) return;
  s.fx = dx / d;
  s.fy = dy / d;
}
