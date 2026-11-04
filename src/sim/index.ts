// The Simulation: pure, deterministic, no DOM, no clocks, no Math.random.
// The four functions below are its whole public surface.
// Only + - * / and Math.sqrt touch floats: those are exact across engines (Math.hypot and trig are not).
import { SIDES, type Command, type CommanderView, type MapData, type MatchResult, type SideId, type SimEvent, type Tune, type Vec2 } from './types';

export * from './types';

interface Soldier {
  id: number;
  side: SideId;
  squad: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
  speed: number; // m per tick
  ox: number; // seeded offset from the Squad's goal
  oy: number;
}

interface Squad {
  id: number;
  side: SideId;
  members: number[];
  goal: number; // index of the Capture Point it is heading for, -1 = not picked yet
}

interface Point {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  owner: SideId | null;
  progress: number; // -stageTicks (pact) .. +stageTicks (nato)
}

export interface Match {
  tick: number;
  rng: number;
  tune: Tune;
  map: MapData;
  soldiers: Soldier[];
  squads: Squad[];
  points: Point[];
  tickets: Record<SideId, number>;
  pointLead: number; // nato points - pact points
  drainTicks: number; // ticks the current point lead has been draining
  result: MatchResult | null;
}

/** mulberry32: seeded 32-bit RNG, returns [0, 1). */
function rnd(m: Match): number {
  m.rng = (m.rng + 0x6d2b79f5) | 0;
  let t = m.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const enemyOf = (s: SideId): SideId => (s === 'nato' ? 'pact' : 'nato');
const sign = (s: SideId) => (s === 'nato' ? 1 : -1);
const sideOf = (n: number): SideId => (n > 0 ? 'nato' : 'pact');
const stageTicks = (t: Tune) => t.captureSeconds * t.hz;

export function createMatch(opts: {
  seed: number;
  map: MapData;
  tune: Tune;
  squadsPerSide: number;
  commanderSide: SideId;
}): Match {
  const { map, tune } = opts;
  const m: Match = {
    tick: 0,
    rng: opts.seed | 0,
    tune,
    map,
    soldiers: [],
    squads: [],
    points: map.points.map((p) => ({ ...p, radius: p.radius ?? tune.captureRadius, owner: null, progress: 0 })),
    tickets: { nato: tune.tickets, pact: tune.tickets },
    pointLead: 0,
    drainTicks: 0,
    result: null,
  };
  for (const side of SIDES) {
    const hq = map.hqs[side];
    for (let q = 0; q < opts.squadsPerSide; q++) {
      const squad: Squad = { id: m.squads.length, side, members: [], goal: -1 };
      m.squads.push(squad);
      for (let i = 0; i < tune.squadSize; i++) {
        const ox = (rnd(m) * 2 - 1) * tune.spread;
        const oy = (rnd(m) * 2 - 1) * tune.spread;
        const speed = (tune.walkSpeed * (1 + (rnd(m) * 2 - 1) * tune.speedJitter)) / tune.hz;
        squad.members.push(m.soldiers.length);
        m.soldiers.push({ id: m.soldiers.length, side, squad: squad.id, x: hq.x + ox, y: hq.y + oy, fx: sign(side), fy: 0, speed, ox, oy });
      }
    }
  }
  return m;
}

function insideCount(m: Match, p: Point, side: SideId): number {
  let n = 0;
  for (const s of m.soldiers) if (s.side === side && dist2(s, p) < p.radius * p.radius) n++;
  return n;
}

/** Squad picks the Capture Point with the best score: value by owner, distance, crowding, stickiness. */
function think(m: Match, sq: Squad) {
  const t = m.tune;
  const leader = m.soldiers[sq.members[0]!]!;
  let best = -1;
  let bestScore = -Infinity;
  m.points.forEach((p, i) => {
    const value =
      p.owner === null ? t.pointValue.neutral
      : p.owner !== sq.side ? t.pointValue.enemy
      : insideCount(m, p, enemyOf(sq.side)) > 0 ? t.pointValue.ownedThreatened
      : t.pointValue.ownedQuiet;
    const others = m.squads.filter((o) => o !== sq && o.side === sq.side && o.goal === i).length;
    const score =
      value -
      (t.distancePenaltyPer100m * Math.sqrt(dist2(p, leader))) / 100 -
      t.crowdPenalty * others +
      (sq.goal === i ? t.stickiness : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  sq.goal = best;
}

function walk(m: Match, s: Soldier) {
  const sq = m.squads[s.squad]!;
  const p = m.points[sq.goal];
  if (!p) return;
  const dx = p.x + s.ox - s.x;
  const dy = p.y + s.oy - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.01) return;
  const v = Math.min(s.speed, d);
  s.fx = dx / d;
  s.fy = dy / d;
  s.x += s.fx * v;
  s.y += s.fy * v;
}

function capture(m: Match, p: Point) {
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
function drain(m: Match) {
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

function end(m: Match) {
  const { nato, pact } = m.tickets;
  const winner = nato === pact ? null : nato > pact ? 'nato' : 'pact';
  if (nato === 0 || pact === 0) m.result = { winner, reason: 'tickets' };
  else if (m.tick >= m.tune.matchSeconds * m.tune.hz) m.result = { winner, reason: 'time' };
}

/** Advances exactly one tick. Commands are tick-stamped; none are acted on yet (Orders and Assets come later). */
export function step(m: Match, _commands: Command[]): SimEvent[] {
  if (m.result) return [];
  const t = m.tune;
  for (const sq of m.squads) if ((m.tick + sq.id) % Math.round(t.thinkSeconds * t.hz) === 0) think(m, sq);
  for (const s of m.soldiers) walk(m, s);
  for (const p of m.points) capture(m, p);
  drain(m);
  m.tick++;
  end(m);
  return [];
}

export function stateHash(m: Match): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(m.tick);
  mix(m.rng);
  for (const s of m.soldiers) {
    mix(Math.round(s.x * 1000));
    mix(Math.round(s.y * 1000));
  }
  for (const sq of m.squads) mix(sq.goal);
  for (const p of m.points) {
    mix(Math.round(p.progress * 2));
    mix(p.owner ? sign(p.owner) + 2 : 0);
  }
  mix(m.tickets.nato);
  mix(m.tickets.pact);
  mix(m.drainTicks);
  return h.toString(16).padStart(8, '0');
}

export function commanderView(m: Match, side: SideId): CommanderView {
  const stage = stageTicks(m.tune);
  const soldierView = (s: Soldier) => ({ id: s.id, x: s.x, y: s.y, fx: s.fx, fy: s.fy });
  return {
    side,
    tick: m.tick,
    seconds: m.tick / m.tune.hz,
    friendlies: m.soldiers.filter((s) => s.side === side).map(soldierView),
    contacts: m.soldiers.filter((s) => s.side !== side).map(soldierView),
    points: m.points.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, radius: p.radius, owner: p.owner, progress: p.progress / stage })),
    tickets: { ...m.tickets },
    result: m.result,
  };
}
