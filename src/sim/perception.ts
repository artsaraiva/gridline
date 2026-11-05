import type { Match } from './index';
import { dist2, inHq } from './geometry';
import { los } from './grid';
import type { Soldier } from './state';

/** Engages the nearest living enemy inside the vision cone and range, in line of sight, and not in its own HQ. */
export function perceive(m: Match, s: Soldier) {
  const t = m.tune;
  let best = -1;
  let bestD2 = t.visionM * t.visionM;
  for (const e of m.soldiers) {
    if (e.side === s.side || e.state !== 'alive') continue;
    const d2 = dist2(s, e);
    if (d2 > bestD2) continue;
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    if (dx * s.fx + dy * s.fy < t.visionCos * Math.sqrt(d2)) continue;
    if (inHq(m, e.side, e)) continue;
    if (!los(m, s, e)) continue;
    best = e.id;
    bestD2 = d2;
  }
  s.target = best;
  if (best < 0) return;
  m.squads[s.squad]!.lastSeen = m.tick;
  const e = m.soldiers[best]!;
  const d = Math.sqrt(bestD2);
  if (d > 0) {
    s.fx = (e.x - s.x) / d;
    s.fy = (e.y - s.y) / d;
  }
}
