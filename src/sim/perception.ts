import type { Match } from './index';
import { dist2, inHq } from './geometry';
import { los } from './grid';
import { forget, see } from './memory';
import { vehicleOf, type Soldier } from './state';
import type { Tune, Vec2 } from './types';
import { look as vehicleLook, seeVehicles } from './vehicles';

/** The perception phase: memory ages, then every living Soldier on foot looks around, then #107 every crewed vehicle. */
export function perceive(m: Match) {
  forget(m);
  for (const s of m.soldiers) if (s.state === 'alive' && s.vehicle < 0 && !s.chute) look(m, s); // #130: a parachutist looks at nothing
  for (const v of m.vehicles) vehicleLook(m, v);
}

/** `p`, `d2` square metres from `s`, is within `visionM` and inside its vision cone. */
const inView = (t: Tune, s: Soldier, p: Vec2, d2: number) => d2 <= t.visionM * t.visionM && (p.x - s.x) * s.fx + (p.y - s.y) * s.fy >= t.visionCos * Math.sqrt(d2);

/** #142: `s` sees the spot `p` on the ground: within `visionM`, inside its vision cone and in line of sight. */
export const sees = (m: Match, s: Soldier, p: Vec2): boolean => inView(m.tune, s, p, dist2(s, p)) && los(m, s, p);

/** #142 #143: a living Soldier on foot, not on a parachute, sees the spot `p`: a Soldier's own eyes on a thing on the ground (a Redeploy Beacon, a Feint's dummy). */
export const looksAt = (m: Match, s: Soldier, p: Vec2): boolean => s.state === 'alive' && s.vehicle < 0 && !s.chute && sees(m, s, p);

/**
 * Sees every living enemy inside the vision cone and range, in line of sight, and not in its own HQ; each goes into
 * the Squad's memory and the Side's sightings. Engages and turns to the nearest (#108: a jeep is a rifle target too).
 */
function look(m: Match, s: Soldier) {
  const t = m.tune;
  const sq = m.squads[s.squad]!;
  let best = -1;
  let bestD2 = t.visionM * t.visionM;
  for (const e of m.soldiers) {
    if (e.side === s.side || e.state !== 'alive' || e.vehicle >= 0) continue; // #107: aboard, it is the vehicle that is seen
    const d2 = dist2(s, e);
    if (!inView(t, s, e, d2)) continue;
    if (inHq(m, e.side, e)) continue;
    if (!e.chute && !los(m, s, e)) continue; // #130: over walls, as anything airborne
    // #75: out of all eyes (UAV or Soldier) last tick and found again by sight alone: no longer UAV-discovered. A UAV still over it re-stamps it this tick (assetEffects runs next).
    if (!m.sightings[s.side].some((o) => o.id === e.id && o.tick >= m.tick - 1)) e.uavUntil = -1;
    see(m, sq, e);
    if (d2 > bestD2) continue;
    best = e.id;
    bestD2 = d2;
  }
  const jeep = seeVehicles(m, s, sq, bestD2); // #107: a tank is never a rifle target
  if (jeep) [best, bestD2] = [jeep.id, dist2(s, jeep)];
  s.target = best;
  if (best < 0) return;
  s.lastTarget = best;
  sq.lastSeen = m.tick;
  const e = m.soldiers[best] ?? vehicleOf(m, best)!;
  const d = Math.sqrt(bestD2);
  if (d > 0) {
    s.fx = (e.x - s.x) / d;
    s.fy = (e.y - s.y) / d;
  }
}
