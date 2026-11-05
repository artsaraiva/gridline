import type { Match } from './index';
import { dist2, inHq } from './geometry';
import { los } from './grid';
import { forget, see } from './memory';
import type { Soldier } from './state';

/** The perception phase: memory ages, then every living Soldier looks around. */
export function perceive(m: Match) {
  forget(m);
  for (const s of m.soldiers) if (s.state === 'alive') look(m, s);
}

/**
 * Sees every living enemy inside the vision cone and range, in line of sight, and not in its own HQ; each goes into
 * the Squad's memory and the Side's sightings. Engages and turns to the nearest.
 */
function look(m: Match, s: Soldier) {
  const t = m.tune;
  const sq = m.squads[s.squad]!;
  let best = -1;
  let bestD2 = t.visionM * t.visionM;
  for (const e of m.soldiers) {
    if (e.side === s.side || e.state !== 'alive') continue;
    const d2 = dist2(s, e);
    if (d2 > t.visionM * t.visionM) continue;
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    if (dx * s.fx + dy * s.fy < t.visionCos * Math.sqrt(d2)) continue;
    if (inHq(m, e.side, e)) continue;
    if (!los(m, s, e)) continue;
    see(m, sq, e);
    if (d2 > bestD2) continue;
    best = e.id;
    bestD2 = d2;
  }
  s.target = best;
  if (best < 0) return;
  s.lastTarget = best;
  sq.lastSeen = m.tick;
  const e = m.soldiers[best]!;
  const d = Math.sqrt(bestD2);
  if (d > 0) {
    s.fx = (e.x - s.x) / d;
    s.fy = (e.y - s.y) / d;
  }
}
