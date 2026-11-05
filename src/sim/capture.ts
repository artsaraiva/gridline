// Capture Points, the Ticket drain and the end of the Match.
import type { Match } from './index';
import { dist2 } from './geometry';
import { sideOf, sign, stageTicks, type Mix, type Point } from './state';
import { enemyOf, type SideId } from './types';

/** Living Soldiers of `side` inside the point; the Wounded and the dead don't count. */
export function insideCount(m: Match, p: Point, side: SideId): number {
  let n = 0;
  for (const s of m.soldiers) if (s.side === side && s.state === 'alive' && dist2(s, p) < p.radius * p.radius) n++;
  return n;
}

export function capture(m: Match, p: Point) {
  const t = m.tune;
  const stage = stageTicks(t);
  const margin = insideCount(m, p, 'nato') - insideCount(m, p, 'pact');
  if (margin === 0) return;
  const rate = Math.min(t.captureMaxMultiplier, 1 + t.captureBonusPerExtra * (Math.abs(margin) - 1));
  p.progress = Math.max(-stage, Math.min(stage, p.progress + Math.sign(margin) * rate));
  if (p.owner && Math.sign(p.progress) !== sign(p.owner)) p.owner = null; // an enemy point goes neutral first
  if (!p.owner && Math.abs(p.progress) >= stage) p.owner = sideOf(p.progress);
}

/** The Side with more Capture Points drains the other's Tickets; the interval restarts when the lead changes. */
export function drain(m: Match) {
  const t = m.tune;
  const lead = m.points.reduce((n, p) => n + (p.owner ? sign(p.owner) : 0), 0);
  if (lead !== m.pointLead) {
    m.pointLead = lead;
    m.drainTicks = 0;
  }
  if (lead === 0) return;
  const seconds = t.drainSeconds[Math.min(Math.abs(lead), t.drainSeconds.length) - 1]!;
  if (++m.drainTicks < seconds * t.hz) return;
  m.drainTicks = 0;
  const loser = enemyOf(sideOf(lead));
  m.tickets[loser] = Math.max(0, m.tickets[loser] - 1);
}

export function end(m: Match) {
  const { nato, pact } = m.tickets;
  const winner = nato === pact ? null : nato > pact ? 'nato' : 'pact';
  if (nato === 0 || pact === 0) m.result = { winner, reason: 'tickets' };
  else if (m.tick >= m.tune.matchSeconds * m.tune.hz) m.result = { winner, reason: 'time' };
}

export function hashCapture(m: Match, mix: Mix) {
  for (const p of m.points) {
    mix(Math.round(p.progress * 2));
    mix(p.owner ? sign(p.owner) + 2 : 0);
  }
  mix(m.tickets.nato);
  mix(m.tickets.pact);
  mix(m.drainTicks);
}
