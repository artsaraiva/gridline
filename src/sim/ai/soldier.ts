// The Soldier layer: where to step this tick (reviving, a spot its Squad sent it to, the wedge, its own line while straying
// (#93) or Detached (#106), the flow field) and the step itself.
import type { Match } from '../index';
import { canStand, dist2, inHq } from '../geometry';
import { lineWalk, walkCost } from '../grid';
import { membersOf, type Soldier } from '../state';
import type { Vec2 } from '../types';
import { flowLook, pointFlow } from './flow';
import { flowOf, goalOf, setDest, wedgeSlot } from './squad';

/** One tick of walking. Faces where it walks unless it has a target. A Soldier in its own HQ gets a full load of ammo. */
export function walk(m: Match, s: Soldier) {
  const t = m.tune;
  if (inHq(m, s.side, s)) Object.assign(s, { ammo: t.ammo, rockets: t.rockets }); // Capture Points never refill
  const w = m.soldiers[s.reviving];
  if (w) {
    if (dist2(s, w) > t.reviveReachM * t.reviveReachM) step(m, s, w, s.speed);
    return;
  }
  const sq = m.squads[s.squad]!;
  const alive = membersOf(m, sq).filter((o) => o.state === 'alive');
  const body = alive.filter((o) => !o.detached && o.vehicle < 0); // #106; #107 nobody aboard
  const L = body[0]!;
  const flow = flowOf(m, sq);
  let to: Vec2 | null = null;
  let pace = 1;
  if (s.strayUntil && s.dest && !s.cover && dist2(s, s.dest) < 1.44) setDest(m, s, null); // #93: at its stray spot; from here it walks its own line
  const spot = s.cover ?? s.dest;
  if (spot) {
    while (s.path.length && dist2(s, s.path[0]!) < 1.44) s.path.shift();
    to = s.path[0] ?? (flow && !lineWalk(m, s, spot) ? flowLook(m, flow, s, 4) : null) ?? spot;
    pace = s.cover ? 1.18 : s.regroup || s.chaseUntil ? 1.14 : s.strayUntil ? (sq.slow ? 0.5 : 1) : sq.mode === 'bound' ? 0.91 : 0.82; // #93: a stray never outruns a waiting leader
  } else if (s.detached) {
    // #106: its own line to its own goal, standing once inside it; inside the Squad's goal it walks over to the Squad to rejoin
    const p = m.points[s.goal];
    const g = p ? { x: p.x, y: p.y, r: p.radius } : goalOf(m, sq);
    const f = p ? pointFlow(m, s.goal) : flow;
    if (f && g && dist2(s, g) > g.r * g.r) to = flowLook(m, f, s, 4);
    else if (!p && L) to = L;
  } else if (flow && (sq.mode === 'travel' || sq.mode === 'fallback')) {
    if (s === L) {
      to = flowLook(m, flow, s, 4);
      pace = sq.slow ? 0.5 : sq.mode === 'fallback' ? 1.14 : 1;
    } else if (m.tick < s.strayUntil) {
      to = flowLook(m, flow, s, 4); // #93: its own line to the goal, a little behind the leader's pace; once the stray ends it catches up to its slot below
      pace = sq.slow ? 0.5 : 0.95;
    } else {
      const slot = wedgeSlot(m, L, body.indexOf(s), s.slot);
      if (dist2(s, L) < 22 * 22 && walkCost(m, slot.x, slot.y) && lineWalk(m, s, slot)) {
        to = slot;
        pace = dist2(s, slot) > 25 ? 1.23 : 1;
      } else {
        to = flowLook(m, flow, s, 4);
        pace = 1.23;
      }
    }
  }
  if (!to) return;
  const terrain = 10 / (walkCost(m, s.x, s.y) || 10);
  if (!step(m, s, to, s.speed * pace * terrain * (1 - 0.3 * s.suppression))) return;
  for (const o of alive) { // keep a little apart
    const ox = s.x - o.x;
    const oy = s.y - o.y;
    const d = Math.sqrt(ox * ox + oy * oy);
    if (o === s || d >= 1.3 || d < 0.01) continue;
    const p = { x: s.x + (ox / d) * 0.06, y: s.y + (oy / d) * 0.06 };
    if (canStand(m, s, p)) Object.assign(s, p);
  }
}

/** Steps up to `v` metres toward `to`, sliding along whichever axis is free when blocked. False when it did not move. */
function step(m: Match, s: Soldier, to: Vec2, v: number): boolean {
  const dx = to.x - s.x;
  const dy = to.y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.01) return false;
  if (s.target < 0) {
    s.fx = dx / d;
    s.fy = dy / d;
  }
  const u = Math.min(v, d);
  const x = s.x + (dx / d) * u;
  const y = s.y + (dy / d) * u;
  if (canStand(m, s, { x, y })) Object.assign(s, { x, y });
  else if (canStand(m, s, { x, y: s.y })) s.x = x;
  else if (canStand(m, s, { x: s.x, y })) s.y = y;
  else if (++s.blocked > 30) { // stuck on a corner: drop the spot, the Squad sends it somewhere else
    Object.assign(s, { blocked: 0, dest: null, path: [], cover: null });
    return false;
  } else return false;
  s.blocked = 0;
  return true;
}
