// The Simulation: pure, deterministic, no DOM, no clocks, no Math.random.
// The four functions below are its whole public surface.
// Only + - * / and Math.sqrt touch floats: those are exact across engines (Math.hypot and trig are not).
import { enemyOf, SIDES, type Command, type CommanderView, type MapData, type MatchResult, type Rect, type SideId, type SimEvent, type SoldierState, type SquadView, type Tune, type Vec2 } from './types';

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
  state: SoldierState;
  hp: number;
  suppression: number; // suppression 0..1
  target: number; // id of the enemy in view it engages, -1 = none
  nextFire: number; // tick
  bleed: number; // Wounded: ticks left before bleeding out
  revive: number; // Wounded: ticks of revive work done on them
  reviving: number; // id of the Wounded squad mate it is reviving, -1 = none
  deadAt: number; // tick
}

interface Squad {
  id: number;
  side: SideId;
  members: number[];
  goal: number; // index of the Capture Point it is heading for, -1 = not picked yet
  lastSeen: number; // tick a member last saw an enemy
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

const WALL = 1;
const COVER = 2;

/** Sight grid over the Play Area's bounding box: one byte per cell, 0 open, WALL or COVER. */
interface Grid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
}

export interface Match {
  tick: number;
  rng: number;
  tune: Tune;
  map: MapData;
  soldiers: Soldier[];
  squads: Squad[];
  points: Point[];
  grid: Grid;
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
const sign = (s: SideId) => (s === 'nato' ? 1 : -1);
const sideOf = (n: number): SideId => (n > 0 ? 'nato' : 'pact');
const stageTicks = (t: Tune) => t.captureSeconds * t.hz;
const membersOf = (m: Match, sq: Squad) => sq.members.map((id) => m.soldiers[id]!);
const wiped = (members: Soldier[]) => members.every((s) => s.state === 'dead');

function buildGrid(map: MapData, cellM: number): Grid {
  const xs = map.playArea.map((p) => p.x);
  const ys = map.playArea.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const cols = Math.ceil((Math.max(...xs) - x0) / cellM);
  const rows = Math.ceil((Math.max(...ys) - y0) / cellM);
  const cells = new Uint8Array(cols * rows);
  const fill = (rects: Rect[] = [], kind: number) => {
    for (const r of rects) // every cell the box overlaps
      for (let j = Math.max(0, Math.floor((r.y0 - y0) / cellM)); j < Math.min(rows, Math.ceil((r.y1 - y0) / cellM)); j++)
        for (let i = Math.max(0, Math.floor((r.x0 - x0) / cellM)); i < Math.min(cols, Math.ceil((r.x1 - x0) / cellM)); i++)
          cells[j * cols + i] = kind;
  };
  fill(map.cover, COVER);
  fill(map.walls, WALL);
  return { x0, y0, cols, rows, cells };
}

function cellAt(m: Match, x: number, y: number): number {
  const g = m.grid;
  const i = Math.floor((x - g.x0) / m.tune.cellM);
  const j = Math.floor((y - g.y0) / m.tune.cellM);
  return i < 0 || j < 0 || i >= g.cols || j >= g.rows ? 0 : g.cells[j * g.cols + i]!;
}

/** Even-odd point-in-polygon. */
function insidePolygon(poly: Vec2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const inHq = (m: Match, side: SideId, p: Vec2) => {
  const hq = m.map.hqs[side];
  const r = hq.radius ?? m.tune.hqRadius;
  return dist2(p, hq) < r * r;
};

/** The Play Area boundary and the enemy HQ are walls to a Soldier. */
const canStand = (m: Match, s: Soldier, p: Vec2) => insidePolygon(m.map.playArea, p.x, p.y) && !inHq(m, enemyOf(s.side), p);

/** Grid line of sight: samples every half cell between the two, blocked by any wall cell. */
function los(m: Match, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.ceil(Math.sqrt(dx * dx + dy * dy) / (m.tune.cellM / 2));
  for (let k = 1; k < n; k++) if (cellAt(m, a.x + (dx * k) / n, a.y + (dy * k) / n) === WALL) return false;
  return true;
}

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
    points: map.points.map((p) => ({ ...p, radius: p.radius ?? tune.captureRadius, owner: p.owner ?? null, progress: p.owner ? sign(p.owner) * stageTicks(tune) : 0 })),
    grid: buildGrid(map, tune.cellM),
    tickets: { nato: tune.tickets, pact: tune.tickets },
    pointLead: 0,
    drainTicks: 0,
    result: null,
  };
  for (const side of SIDES) {
    const hq = map.hqs[side];
    for (let q = 0; q < opts.squadsPerSide; q++) {
      const squad: Squad = { id: m.squads.length, side, members: [], goal: -1, lastSeen: -1e9 };
      m.squads.push(squad);
      for (let i = 0; i < tune.squadSize; i++) {
        const ox = (rnd(m) * 2 - 1) * tune.spread;
        const oy = (rnd(m) * 2 - 1) * tune.spread;
        const speed = (tune.walkSpeed * (1 + (rnd(m) * 2 - 1) * tune.speedJitter)) / tune.hz;
        squad.members.push(m.soldiers.length);
        m.soldiers.push({
          id: m.soldiers.length, side, squad: squad.id, x: hq.x + ox, y: hq.y + oy, fx: sign(side), fy: 0, speed, ox, oy,
          state: 'alive', hp: tune.hp, suppression: 0, target: -1, nextFire: 0, bleed: 0, revive: 0, reviving: -1, deadAt: 0,
        });
      }
    }
  }
  return m;
}

/** Living Soldiers of `side` inside the point; the Wounded and the dead don't count. */
function insideCount(m: Match, p: Point, side: SideId): number {
  let n = 0;
  for (const s of m.soldiers) if (s.side === side && s.state === 'alive' && dist2(s, p) < p.radius * p.radius) n++;
  return n;
}

/** Squad picks the Capture Point with the best score: value by owner, distance, crowding, stickiness. */
function think(m: Match, sq: Squad) {
  const t = m.tune;
  const leader = membersOf(m, sq).find((s) => s.state === 'alive') ?? m.soldiers[sq.members[0]!]!;
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

/** Engages the nearest living enemy inside the vision cone and range, in line of sight, and not in its own HQ. */
function perceive(m: Match, s: Soldier) {
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

interface Shot {
  shooter: Soldier;
  target: Soldier;
  hit: boolean;
  damage: number;
}

/** Decides a shot from the pre-fire state; every shot of the tick is applied together afterwards. */
function aim(m: Match, s: Soldier): Shot | null {
  const t = m.tune;
  if (s.target < 0 || s.reviving >= 0 || m.tick < s.nextFire) return null;
  const e = m.soldiers[s.target]!;
  if (dist2(s, e) > t.fireRangeM * t.fireRangeM) return null;
  const p = t.hitChance * (1 - t.suppressAccuracyLoss * s.suppression) * (cellAt(m, e.x, e.y) === COVER ? t.coverHitMul : 1);
  const hit = rnd(m) < p;
  const damage = hit ? t.damage[0] + rnd(m) * (t.damage[1] - t.damage[0]) : 0;
  s.nextFire = m.tick + Math.round((t.fireSeconds + rnd(m) * t.fireJitterSeconds) * t.hz);
  return { shooter: s, target: e, hit, damage };
}

function fire(m: Match, events: SimEvent[]) {
  const shots: Shot[] = [];
  for (const s of m.soldiers) {
    if (s.state !== 'alive') continue;
    const shot = aim(m, s);
    if (shot) shots.push(shot);
  }
  for (const { shooter, target: e, hit, damage } of shots) {
    e.hp -= damage;
    e.suppression = Math.min(1, e.suppression + m.tune.suppressPerShot);
    events.push({ kind: 'shot', side: shooter.side, from: shooter.id, to: e.id, hit });
  }
  for (const { target: e } of shots) {
    if (e.state !== 'alive' || e.hp > 0) continue;
    Object.assign(e, { state: 'wounded', suppression: 0, target: -1, reviving: -1, revive: 0, bleed: m.tune.bleedOutSeconds * m.tune.hz });
    events.push({ kind: 'wounded', side: e.side, id: e.id, x: e.x, y: e.y });
  }
}

function die(m: Match, s: Soldier, events: SimEvent[]) {
  s.state = 'dead';
  s.deadAt = m.tick;
  m.tickets[s.side] = Math.max(0, m.tickets[s.side] - 1);
  events.push({ kind: 'death', side: s.side, id: s.id, x: s.x, y: s.y });
}

/**
 * Each Wounded Soldier gets the nearest unpinned squad mate in range as their reviver. The bleed-out clock runs
 * while the reviver runs over and pauses while they work beside the Wounded (so a mate up to about 38 m away
 * makes it); a reviver that is pinned or goes down drops the job.
 */
function casualties(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const w of m.soldiers) {
    if (w.state !== 'wounded') continue;
    const mates = membersOf(m, m.squads[w.squad]!);
    let r = mates.find((s) => s.reviving === w.id);
    if (r && r.suppression > t.pinnedAt) {
      r.reviving = -1;
      r = undefined;
    }
    if (!r) {
      let best = t.reviveRangeM * t.reviveRangeM;
      for (const s of mates) {
        if (s.state !== 'alive' || s.reviving >= 0 || s.suppression > t.pinnedAt || dist2(s, w) > best) continue;
        best = dist2(s, w);
        r = s;
      }
      if (r) r.reviving = w.id;
    }
    if (!r || dist2(r, w) > t.reviveReachM * t.reviveReachM) {
      if (--w.bleed > 0) continue;
      if (r) r.reviving = -1;
      die(m, w, events);
    } else if (++w.revive >= t.reviveSeconds * t.hz) {
      r.reviving = -1;
      Object.assign(w, { state: 'alive', hp: t.reviveHp, nextFire: m.tick });
      events.push({ kind: 'revived', side: w.side, id: w.id, by: r.id });
    }
  }
}

function bringBack(m: Match, s: Soldier, at: Vec2) {
  Object.assign(s, { x: at.x, y: at.y, state: 'alive', hp: m.tune.hp, suppression: 0, target: -1, reviving: -1, nextFire: m.tick });
}

/** A Squad is quiet when no member saw an enemy for `quietSeconds` and no living member is suppressed. */
function quiet(m: Match, sq: Squad, members: Soldier[]): boolean {
  const t = m.tune;
  return m.tick - sq.lastSeen >= t.quietSeconds * t.hz && !members.some((s) => s.state === 'alive' && s.suppression > t.suppressedAt);
}

/** Where a wiped Squad Redeploys: the owned, uncontested Capture Point nearest its goal (or its HQ), else its HQ. */
function redeployAt(m: Match, sq: Squad): Vec2 {
  const hq = m.map.hqs[sq.side];
  const near = m.points[sq.goal] ?? hq;
  let at: Vec2 = hq;
  let best = Infinity;
  for (const p of m.points) {
    if (p.owner !== sq.side || insideCount(m, p, enemyOf(sq.side)) > 0 || dist2(p, near) >= best) continue;
    best = dist2(p, near);
    at = p;
  }
  return at;
}

const lastDeath = (members: Soldier[]) => Math.max(...members.map((s) => s.deadAt));

/**
 * Squad Respawn: dead members return `respawnBehindM` behind the first living member once their time is up and the Squad is quiet.
 * Redeploy: a wiped Squad (every member dead) returns whole, `redeploySeconds` after its last death.
 */
function returnToFight(m: Match, events: SimEvent[]) {
  const t = m.tune;
  for (const sq of m.squads) {
    const members = membersOf(m, sq);
    if (wiped(members)) {
      if (m.tick - lastDeath(members) < t.redeploySeconds * t.hz) continue;
      const at = redeployAt(m, sq);
      for (const s of members) {
        const spot = { x: at.x + s.ox, y: at.y + s.oy };
        bringBack(m, s, canStand(m, s, spot) ? spot : at);
      }
      events.push({ kind: 'redeploy', side: sq.side, squad: sq.id, x: at.x, y: at.y });
      continue;
    }
    const leader = members.find((s) => s.state === 'alive');
    if (!leader || !quiet(m, sq, members)) continue;
    for (const s of members) {
      if (s.state !== 'dead' || m.tick - s.deadAt < t.respawnSeconds * t.hz) continue;
      const behind = { x: leader.x - leader.fx * t.respawnBehindM, y: leader.y - leader.fy * t.respawnBehindM };
      bringBack(m, s, canStand(m, s, behind) ? behind : leader);
      events.push({ kind: 'respawn', side: s.side, id: s.id, x: s.x, y: s.y });
    }
  }
}

/** Walks toward the Wounded squad mate it is reviving, else toward its Squad's goal. Faces its target if it has one. */
function walk(m: Match, s: Soldier) {
  const t = m.tune;
  const w = m.soldiers[s.reviving];
  const p = m.points[m.squads[s.squad]!.goal];
  let dx: number;
  let dy: number;
  if (w) {
    if (dist2(s, w) <= t.reviveReachM * t.reviveReachM) return;
    dx = w.x - s.x;
    dy = w.y - s.y;
  } else if (p) {
    dx = p.x + s.ox - s.x;
    dy = p.y + s.oy - s.y;
  } else return;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.01) return;
  const v = Math.min(s.speed, d);
  const x = s.x + (dx / d) * v;
  const y = s.y + (dy / d) * v;
  // blocked: slide along whichever axis is free, else stand
  if (canStand(m, s, { x, y })) Object.assign(s, { x, y });
  else if (canStand(m, s, { x, y: s.y })) s.x = x;
  else if (canStand(m, s, { x: s.x, y })) s.y = y;
  if (s.target >= 0) return;
  s.fx = dx / d;
  s.fy = dy / d;
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
  const events: SimEvent[] = [];
  for (const sq of m.squads) if ((m.tick + sq.id) % Math.round(t.thinkSeconds * t.hz) === 0) think(m, sq);
  casualties(m, events);
  for (const s of m.soldiers) if (s.state === 'alive') perceive(m, s);
  fire(m, events);
  for (const s of m.soldiers) if (s.state === 'alive') walk(m, s);
  for (const s of m.soldiers) s.suppression = Math.max(0, s.suppression - t.suppressDecayPerSecond / t.hz);
  returnToFight(m, events);
  for (const p of m.points) capture(m, p);
  drain(m);
  m.tick++;
  end(m);
  return events;
}

export function stateHash(m: Match): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(m.tick);
  mix(m.rng);
  const STATE = { alive: 0, wounded: 1, dead: 2 };
  for (const s of m.soldiers) {
    mix(Math.round(s.x * 1000));
    mix(Math.round(s.y * 1000));
    mix(Math.round(s.fx * 1000));
    mix(Math.round(s.fy * 1000));
    mix(STATE[s.state]);
    mix(Math.round(s.hp * 1000));
    mix(Math.round(s.suppression * 1000));
    mix(s.target);
    mix(s.nextFire);
    mix(s.bleed);
    mix(s.revive);
    mix(s.reviving);
    mix(s.deadAt);
  }
  for (const sq of m.squads) {
    mix(sq.goal);
    mix(sq.lastSeen);
  }
  for (const p of m.points) {
    mix(Math.round(p.progress * 2));
    mix(p.owner ? sign(p.owner) + 2 : 0);
  }
  mix(m.tickets.nato);
  mix(m.tickets.pact);
  mix(m.drainTicks);
  return h.toString(16).padStart(8, '0');
}

const SQUAD_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

function squadView(m: Match, sq: Squad, i: number): SquadView {
  const t = m.tune;
  const members = membersOf(m, sq);
  // seconds until the step that acts at tick `due` has run; 0 once due and still waiting
  const secondsUntil = (due: number) => Math.max(0, due - m.tick + 1) / t.hz;
  const gone = wiped(members);
  return {
    id: sq.id,
    name: SQUAD_NAMES[i] ?? `Squad ${i + 1}`,
    size: members.length,
    strength: members.filter((s) => s.state === 'alive').length,
    respawnIn: gone ? [] : members.filter((s) => s.state === 'dead').map((s) => secondsUntil(s.deadAt + t.respawnSeconds * t.hz)),
    redeployIn: gone ? secondsUntil(lastDeath(members) + t.redeploySeconds * t.hz) : null,
  };
}

export function commanderView(m: Match, side: SideId): CommanderView {
  const stage = stageTicks(m.tune);
  const soldierView = (s: Soldier) => ({ id: s.id, x: s.x, y: s.y, fx: s.fx, fy: s.fy });
  return {
    side,
    tick: m.tick,
    seconds: m.tick / m.tune.hz,
    friendlies: m.soldiers
      .filter((s) => s.side === side && s.state !== 'dead')
      .map((s) => ({ ...soldierView(s), squad: s.squad, state: s.state as 'alive' | 'wounded', suppressed: s.suppression > m.tune.suppressedAt })),
    contacts: m.soldiers.filter((s) => s.side !== side && s.state === 'alive').map(soldierView),
    squads: m.squads.filter((sq) => sq.side === side).map((sq, i) => squadView(m, sq, i)),
    points: m.points.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, radius: p.radius, owner: p.owner, progress: p.progress / stage })),
    tickets: { ...m.tickets },
    result: m.result,
  };
}
