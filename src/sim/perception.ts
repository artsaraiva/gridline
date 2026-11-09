import type { Match } from './index';
import { dist2, inHq } from './geometry';
import { los } from './grid';
import { forget, see } from './memory';
import { vehicleOf, type Soldier } from './state';
import { look as vehicleLook, seeVehicles } from './vehicles';

/** The perception phase: memory ages, then every living Soldier on foot looks around, then #107 every crewed vehicle. */
export function perceive(m: Match) {
  forget(m);
  for (const s of m.soldiers) if (s.state === 'alive' && s.vehicle < 0 && !s.chute) look(m, s); // #130: a parachutist looks at nothing
  for (const v of m.vehicles) vehicleLook(m, v);
}

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
    if (d2 > t.visionM * t.visionM) continue;
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    if (dx * s.fx + dy * s.fy < t.visionCos * Math.sqrt(d2)) continue;
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
