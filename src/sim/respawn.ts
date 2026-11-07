// Squad Respawn and Redeploy.
import type { Match } from './index';
import { resetSoldierAi } from './ai';
import { insideCount } from './capture';
import { canStand, dist2 } from './geometry';
import { nearestWalkable } from './grid';
import { footLeader, lastDeath, membersOf, wiped, type Point, type Soldier, type Squad } from './state';
import { enemyOf, type SimEvent, type Vec2 } from './types';

function bringBack(m: Match, s: Soldier, at: Vec2) {
  Object.assign(s, { x: at.x, y: at.y, state: 'alive', hp: m.tune.hp, suppression: 0, target: -1, reviving: -1, nextFire: m.tick, ...resetSoldierAi(m) });
}

/** A Squad is quiet when no member saw an enemy for `quietSeconds` and no living member is suppressed. */
export function quiet(m: Match, sq: Squad, members: Soldier[]): boolean {
  const t = m.tune;
  return m.tick - sq.lastSeen >= t.quietSeconds * t.hz && !members.some((s) => s.state === 'alive' && s.suppression > t.suppressedAt);
}

/** Where a wiped Squad Redeploys: the owned, uncontested Capture Point nearest its Order's point or goal (or its HQ), else its HQ. */
export function redeployPoint(m: Match, sq: Squad): Point | null {
  const near = m.points[sq.order?.point ?? sq.goal] ?? m.map.hqs[sq.side]; // an Order steers the choice
  let at: Point | null = null;
  let best = Infinity;
  for (const p of m.points) {
    if (p.owner !== sq.side || insideCount(m, p, enemyOf(sq.side)) > 0 || dist2(p, near) >= best) continue;
    best = dist2(p, near);
    at = p;
  }
  return at;
}

/**
 * Squad Respawn: dead members return `respawnBehindM` behind the foot leader once their time is up and the Squad is quiet.
 * Redeploy: a wiped Squad (every member dead) returns whole, `redeploySeconds` after its last death.
 */
export function returnToFight(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const sq of m.squads) {
    const members = membersOf(m, sq);
    if (wiped(members)) {
      if (m.tick - lastDeath(members) < t.redeploySeconds * t.hz) continue;
      const at = nearestWalkable(m, redeployPoint(m, sq) ?? m.map.hqs[sq.side]);
      for (const s of members) {
        const spot = { x: at.x + s.ox, y: at.y + s.oy };
        bringBack(m, s, canStand(m, s, spot) ? spot : at);
      }
      events.push({ kind: 'redeploy', side: sq.side, squad: sq.id, x: at.x, y: at.y });
      continue;
    }
    const leader = footLeader(members.filter((s) => s.state === 'alive'));
    if (!leader || !quiet(m, sq, members)) continue;
    for (const s of members) {
      if (s.state !== 'dead' || m.tick - s.deadAt < t.respawnSeconds * t.hz) continue;
      const behind = { x: leader.x - leader.fx * t.respawnBehindM, y: leader.y - leader.fy * t.respawnBehindM };
      bringBack(m, s, canStand(m, s, behind) ? behind : leader);
      events.push({ kind: 'respawn', side: s.side, id: s.id, x: s.x, y: s.y });
    }
  }
}
