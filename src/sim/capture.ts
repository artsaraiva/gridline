// Capture Points, the Ticket drain and the end of the Match; a capture under an Order earns the Commander Score (#73).
import type { Match } from './index';
import { dist2 } from './geometry';
import { award } from './score';
import { callName, sideOf, sign, stageTicks, vehicleOf, type Mix, type Point, type Soldier } from './state';
import { enemyOf, SIDES, type SideId, type SimEvent } from './types';

/** A ring on the ground: a Capture Point, or #142 a Redeploy Beacon's deny ring. */
type Ring = Pick<Point, 'x' | 'y' | 'radius'>;

/** A living Soldier inside the point, and not #109 up in a helicopter: they count for it. */
const counts = (m: Match, s: Soldier, p: Ring) => s.state === 'alive' && dist2(s, p) < p.radius * p.radius && !vehicleOf(m, s.vehicle)?.airborne && !s.chute;

/** Living Soldiers of `side` inside the point (#142: or any ring); the Wounded, the dead and #109 the airborne don't count. */
export function insideCount(m: Match, p: Ring, side: SideId): number {
  let n = 0;
  for (const s of m.soldiers) if (s.side === side && counts(m, s, p)) n++;
  return n;
}

export function capture(m: Match, p: Point, events: SimEvent[]) {
  const t = m.tune;
  const stage = stageTicks(t);
  const margin = insideCount(m, p, 'nato') - insideCount(m, p, 'pact');
  if (margin === 0) return;
  if (p.owner !== sideOf(margin)) contribute(m, p, sideOf(margin)); // #73
  const rate = Math.min(t.captureMaxMultiplier, 1 + t.captureBonusPerExtra * (Math.abs(margin) - 1));
  p.progress = Math.max(-stage, Math.min(stage, p.progress + Math.sign(margin) * rate));
  if (p.owner && Math.sign(p.progress) !== sign(p.owner)) p.owner = null; // an enemy point goes neutral first
  if (!p.owner && Math.abs(p.progress) >= stage) {
    p.owner = sideOf(p.progress);
    taken(m, p, events); // #73
  }
}

/**
 * #73: a Squad begins contributing to a capture on the first tick a living member is inside the point while its Side's
 * progress is moving towards taking it. That tick stays through contested or interrupted spells (the Squad may leave and
 * return) until the point is taken by either Side, which ends the capture; a Squad contributing to another point starts afresh.
 */
function contribute(m: Match, p: Point, side: SideId) {
  const i = m.points.indexOf(p);
  for (const s of m.soldiers) {
    if (s.side !== side || !counts(m, s, p)) continue;
    const sq = m.squads[s.squad]!;
    if (sq.taking !== i) Object.assign(sq, { taking: i, takingSince: m.tick });
  }
}

/**
 * #73: the point is just taken. The Commander scores once if any contributing Squad holds an Order on it given before it began
 * contributing, with no Command (a clear or any new Order) still awaiting acknowledgement. Orders have no attack/hold kind: hold
 * is derived from ownership, so a hold Order on a point since lost counts when the Squad retakes it.
 */
function taken(m: Match, p: Point, events: SimEvent[]) {
  const i = m.points.indexOf(p);
  const ordered = m.squads.some((sq) => sq.side === p.owner && sq.taking === i && !sq.pending && sq.order?.point === i && sq.order.since < sq.takingSince);
  for (const sq of m.squads) if (sq.taking === i) sq.taking = -1;
  if (ordered) award(m, p.owner!, 'orders', m.tune.scoreOrderedCapture, `Ordered capture of ${callName(p.name)}`, events);
}

/** nato points − pact points. */
const leadOf = (m: Match) => m.points.reduce((n, p) => n + (p.owner ? sign(p.owner) : 0), 0);

/**
 * #152: Squads per Side over `ticketBaseSquads`, the count #42 tuned Tickets and the drain at. Starting Tickets and the drain both
 * scale by it, so a death costs the same share of a Side's Tickets and the drain keeps its weight against deaths.
 */
const ticketScale = (m: Match) => m.squads.length / SIDES.length / m.tune.ticketBaseSquads;

/** #152: each Side's starting Tickets. */
export const ticketsStart = (m: Match) => Math.round(m.tune.tickets * ticketScale(m));

/** #152: seconds per Ticket at scale 1 for a lead of `lead`, the table indexed by the lead's share of the points; 5 points or fewer drain as #42 tuned. */
function drainSeconds(m: Match, lead: number) {
  const d = m.tune.drainSeconds;
  return d[Math.ceil((d.length * Math.abs(lead)) / Math.max(m.points.length, d.length)) - 1]!;
}

/** #152: seconds per enemy Ticket the point lead drains right now, for the Console; null when level. */
export function drainEvery(m: Match): number | null {
  const lead = leadOf(m);
  return lead ? drainSeconds(m, lead) / ticketScale(m) : null;
}

/**
 * The Side with more Capture Points drains the other's Tickets; the debt restarts when the lead changes. #152: the debt grows by
 * the Ticket scale each tick rather than the interval shrinking by it, which would round up to whole ticks (1.25 s / 8 at 20 Hz is
 * 3.125 ticks, drained on tick 4); at scale 1 a Ticket goes on the same ticks as before.
 */
export function drain(m: Match) {
  const lead = leadOf(m);
  if (lead !== m.pointLead) {
    m.pointLead = lead;
    m.drainDebt = 0;
  }
  if (lead === 0) return;
  const every = drainSeconds(m, lead) * m.tune.hz;
  const loser = enemyOf(sideOf(lead));
  for (m.drainDebt += ticketScale(m); m.drainDebt >= every; m.drainDebt -= every) m.tickets[loser] = Math.max(0, m.tickets[loser] - 1);
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
  mix(Math.round(m.drainDebt * 1000));
}
