// Squad Respawn and Redeploy.
import type { Match } from './index';
import { resetSoldierAi } from './ai';
import { insideCount } from './capture';
import { canStand, dist2 } from './geometry';
import { nearestWalkable } from './grid';
import { footLeader, lastDeath, membersOf, vehicleOf, wiped, type Point, type Soldier, type Squad } from './state';
import { rnd } from './rng';
import { enemyOf, type SideId, type SimEvent, type Vec2 } from './types';
import { boardOnReturn, inSky, leave } from './vehicles';
import type { Effect } from './assets/core';
import { beaconDenied, liveBeacon } from './assets/crate';

/** #101: `side`'s Gunship on station, if it has one: a Soldier coming back may take a seat in it (`boardOnReturn`). Its Asset's effect is read here, so no vehicle module reads one. */
const onStation = (m: Match, side: SideId) => vehicleOf(m, m.assets.effects.find((e) => e.asset === 'gunship' && e.side === side && e.phase === 'station')?.vehicle ?? -1);

function bringBack(m: Match, s: Soldier, at: Vec2) {
  leave(m, s);
  Object.assign(s, { x: at.x, y: at.y, state: 'alive', hp: m.tune.hp, suppression: 0, target: -1, reviving: -1, nextFire: m.tick, rockets: m.tune.rockets, exited: -1, ...resetSoldierAi(m) });
}

const SPOT_CLEAR_M = 10;

/**
 * Where a Squad comes into its HQ: a seeded pick of the HQ's spawn spots with no living friendly Soldier within `SPOT_CLEAR_M`
 * (of them all when every one is taken), so Squads never pile onto one spot; the centre on a map that lists none (no draw).
 */
export function spawnSpot(m: Match, side: SideId): Vec2 {
  const hq = m.map.hqs[side];
  if (!hq.spawns?.length) return hq;
  const free = hq.spawns.filter((p) => !m.soldiers.some((s) => s.side === side && s.state === 'alive' && dist2(s, p) < SPOT_CLEAR_M * SPOT_CLEAR_M));
  const from = free.length ? free : hq.spawns;
  return from[Math.floor(rnd(m) * from.length)]!;
}

/** A Squad is quiet when no member saw an enemy for `quietSeconds` and no living member is suppressed. */
export function quiet(m: Match, sq: Squad, members: Soldier[]): boolean {
  const t = m.tune;
  return m.tick - sq.lastSeen >= t.quietSeconds * t.hz && !members.some((s) => s.state === 'alive' && s.suppression > t.suppressedAt);
}

/**
 * #142: the Rapid Deploy multiplier on `side`'s respawn and Redeploy times: `rapidMul` while one works, else 1. Read against the
 * whole time at every tick, so a timer already running is shortened the same way (one past its shortened time comes back at once).
 */
const timerMul = (m: Match, side: SideId) => (m.assets.effects.some((e) => e.asset === 'rapid' && e.side === side) ? m.tune.rapidMul : 1);

/** Ticks from a death until that member may Squad Respawn (#142: shortened while Rapid Deploy works). */
export const respawnTicks = (m: Match, side: SideId) => m.tune.respawnSeconds * m.tune.hz * timerMul(m, side);

/** Ticks from a Squad's last death until it Redeploys (#142: shortened while Rapid Deploy works). */
export const redeployTicks = (m: Match, side: SideId) => m.tune.redeploySeconds * m.tune.hz * timerMul(m, side);

/** What steers where a wiped Squad comes back: its Order's point, else its goal, else its HQ. */
const steer = (m: Match, sq: Squad): Vec2 => m.points[sq.order?.point ?? sq.goal] ?? m.map.hqs[sq.side];

/** Where a wiped Squad Redeploys (#107: those who find a free vehicle seat ride it instead; see boardOnReturn): the owned, uncontested Capture Point nearest its Order's point or goal (or its HQ), else its HQ. #142: unless `redeployBeacon` has it. */
export function redeployPoint(m: Match, sq: Squad): Point | null {
  const near = steer(m, sq); // an Order steers the choice
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
 * #142: the Side's Redeploy Beacon when a wiped Squad comes back there rather than at `redeployPoint`: landed, silent while a
 * living enemy Soldier stands within `beaconDenyM`, and nearer the Squad's Order point or goal than both the Capture Point
 * `redeployPoint` picks and the HQ. Every Squad of the Side uses it, Elite or not (#153: the beacon is physical, Side-wide).
 * Squad Respawn never does: a dead member still comes back behind the leader, or where `redeployPoint` says (out of scope).
 */
export function redeployBeacon(m: Match, sq: Squad): Effect | null {
  const b = liveBeacon(m, sq.side);
  if (!b || beaconDenied(m, b)) return null;
  const near = steer(m, sq);
  const d = dist2(b, near);
  const p = redeployPoint(m, sq);
  return d < dist2(m.map.hqs[sq.side], near) && (!p || d < dist2(p, near)) ? b : null;
}

/**
 * Squad Respawn: dead members return `respawnBehindM` behind the foot leader once their time is up and the Squad is quiet;
 * #107 into a free seat of the Squad Leader's vehicle while the leader is aboard, else into the driver's seat of an idle one.
 * Redeploy: a wiped Squad (every member dead) returns whole, `redeploySeconds` after its last death. #110: a jet's pilot (#101 or
 * anyone aboard the Gunship) is nobody to come back behind: with no one else alive, the dead come back where the Squad would
 * Redeploy. #101: anyone coming back may take a seat in its Side's Gunship instead (`boardOnReturn`).
 */
export function returnToFight(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const sq of m.squads) {
    const members = membersOf(m, sq);
    if (wiped(members)) {
      if (m.tick - lastDeath(members) < redeployTicks(m, sq.side)) continue;
      const at = nearestWalkable(m, redeployBeacon(m, sq) ?? redeployPoint(m, sq) ?? spawnSpot(m, sq.side)); // #142: round the beacon, spread as at a point
      for (const s of members) {
        const spot = { x: at.x + s.ox, y: at.y + s.oy };
        bringBack(m, s, canStand(m, s, spot) ? spot : at);
        boardOnReturn(m, sq, s, onStation(m, s.side)); // #107: or in a vehicle with a free seat for it
      }
      events.push({ kind: 'redeploy', side: sq.side, squad: sq.id, x: at.x, y: at.y });
      continue;
    }
    const leader = footLeader(members.filter((s) => s.state === 'alive' && !inSky(m, s)));
    if (!quiet(m, sq, members)) continue;
    let home: Vec2 | undefined = leader;
    for (const s of members) {
      if (s.state !== 'dead' || m.tick - s.deadAt < respawnTicks(m, sq.side)) continue;
      home ??= nearestWalkable(m, redeployPoint(m, sq) ?? spawnSpot(m, sq.side)); // drawn once, and only when someone comes back
      const behind = leader ? { x: leader.x - leader.fx * t.respawnBehindM, y: leader.y - leader.fy * t.respawnBehindM } : home;
      bringBack(m, s, canStand(m, s, behind) ? behind : home);
      boardOnReturn(m, sq, s, onStation(m, s.side));
      events.push({ kind: 'respawn', side: s.side, id: s.id, x: s.x, y: s.y });
    }
  }
}
