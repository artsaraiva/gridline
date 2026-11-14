// #110: the AA, a ground vehicle crewed alone like a tank: the Capture Point its driver lays back on (`aaPoint`), its eyes on the sky
// and the gun's bursts at what they see (`aaRound`), and its lock-on missile.
import type { Match } from '../index';
import { freshLock, lockOn } from '../air-missiles';
import { dist2, keystone } from '../geometry';
import { between } from '../rng';
import { ticksOf, vehicleOf, type Soldier } from '../state';
import { enemyOf, type Vec2 } from '../types';
import { crippled, flies, live, unmanned, type Vehicle, type VehicleOf } from './body';
import type { Shot, Shots, VehicleRules } from './core';
import { freshDrive } from './drive-route';
import { rifleChance } from './seats';
import { groundMove, head, setsOff } from './ground';

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

/**
 * #110: an AA's gun, at its target (air first, else a jeep) or else its infantry target: bursts of `aaBurstSeconds` (seeded) of a
 * round every `aaFireSeconds`, each followed by an `aaPauseSeconds` pause (seeded); a fresh target gets a fresh burst. A round on a
 * vehicle hits with `aaHitChance` for `aaRoundDamage`; on a Soldier it is the rifle shot model.
 */
function aaRound(m: Match, s: Soldier, v: VehicleOf<'aa'>, shots: Shots): Shot | null {
  const t = m.tune;
  const e = vehicleOf(m, v.target) ?? m.soldiers[v.coax];
  if (!e) {
    v.burstUntil = -1;
    return null;
  }
  if (m.tick < s.nextFire) return null;
  if (v.burstUntil < 0) v.burstUntil = m.tick + ticksOf(t, between(m, t.aaBurstSeconds));
  else if (m.tick >= v.burstUntil) {
    s.nextFire = m.tick + ticksOf(t, between(m, t.aaPauseSeconds));
    v.burstUntil = -1;
    return null;
  }
  const shot = 'kind' in e ? shots.roll(m, s, null, t.aaHitChance, t.aaFireSeconds, e) : shots.roll(m, s, e, rifleChance(m, e), t.aaFireSeconds);
  s.nextFire = m.tick + ticksOf(t, t.aaFireSeconds); // a steady cadence within the burst, not the rifle's jitter
  if ('kind' in e) shot.damage = shot.hit ? t.aaRoundDamage : 0;
  return shot;
}

export const aa: VehicleRules<'aa'> = {
  init: () => ({ burstUntil: -1, missile: freshLock(), drive: freshDrive() }),
  move: groundMove,
  goal: (m, _sq, _s, v) => aaPoint(m, v), // lays back, whatever its Squad's goal
  onGoal: head, // with no rear point left it stops where it is
  onDriver: setsOff((m, _sq, _s, v) => aaPoint(m, v)),
  boardsOnFoot: true, // crewed alone, as a tank
  wantsOut: (m, _sq, _s, v) => crippled(m, v), // its crew get out only under a third of its hit points
  rank: {
    range: (t) => t.aaRangeM,
    sky: true,
    /** A jet first, then a helicopter (the Gunship is fired on as one), then (#139) a drone or the Recon Plane, then a jeep within `aaGroundRangeM`; never a tank, nor infantry (its coax's). */
    of: (m, _v, e, d2) => ('kind' in e ? (flies(e) ? (e.kind === 'jet' ? 0 : unmanned(e) ? 2 : 1) : e.kind === 'jeep' && d2 <= m.tune.aaGroundRangeM * m.tune.aaGroundRangeM ? 3 : undefined) : undefined),
  },
  seatFire: aaRound,
  /** It locks on its gun's target when that is in the air class. */
  lock(m, v) {
    const target = vehicleOf(m, v.target);
    lockOn(m, v, v.missile, target && flies(target) ? target.id : -1, m.tune.aaLockSeconds, m.tune.aaReloadSeconds);
  },
};
