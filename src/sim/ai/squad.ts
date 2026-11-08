// The Squad layer: survival first (Retreat, Resupply), else the Capture Point with the best score; then how to move there
// (travel in a wedge, bound under fire, flank, hold), plus the Soldier jobs it hands out (peel-off, cover when pinned, regroup,
// #93 straying from the wedge), and the #106 Detached members who pick their own goal. #107: members aboard a vehicle are
// out of all of it (the wedge forms on the first on foot); each Soldier on foot may board one, each aboard may get out.
import type { Match } from '../index';
import { insideCount } from '../capture';
import { nearestCrate } from '../assets/crate';
import { canStand, dist2 } from '../geometry';
import { gridRef } from '../grid-ref';
import { lineWalk, nearestWalkable } from '../grid';
import { quiet } from '../respawn';
import { rnd } from '../rng';
import { membersOf, type Point, type Soldier, type Squad } from '../state';
import { enemyOf, type SimEvent, type Vec2 } from '../types';
import { localPath, oct, pickCover, shelter } from './cover';
import { crateFlow, flowDist, flowLook, hqFlow, pointFlow, routeFlow, type Flow } from './flow';
import { chooseRoute } from './routes';
import { board, decideRide, ride } from '../vehicles';

const sq2 = (r: number) => r * r;

/** The landed friendly crate a resupplying Squad heads for (nearest its leader), or null: then it goes to the HQ. */
const crateOf = (m: Match, sq: Squad) => {
  const L = membersOf(m, sq).find((s) => s.state === 'alive');
  return sq.task === 'resupply' && L ? nearestCrate(m, sq.side, L) : null;
};

/** Where the Squad's task takes it, with the radius that counts as there; null = no task. */
export function goalOf(m: Match, sq: Squad): (Vec2 & { r: number }) | null {
  if (sq.task === 'none') return null;
  const crate = crateOf(m, sq);
  if (crate) return { x: crate.x, y: crate.y, r: m.tune.supplyRadiusM * 0.6 };
  const p = m.points[sq.goal];
  if (p) return { x: p.x, y: p.y, r: p.radius };
  const hq = m.map.hqs[sq.side];
  return { x: hq.x, y: hq.y, r: (hq.radius ?? m.tune.hqRadius) * 0.6 };
}

/** The flow field the Squad walks on to its goal. */
export function flowOf(m: Match, sq: Squad): Flow | null {
  if (sq.task === 'none') return null;
  const crate = crateOf(m, sq);
  if (crate) return crateFlow(m, crate);
  if (sq.goal < 0) return hqFlow(m, sq.side);
  return sq.task === 'point' && sq.route >= 0 ? routeFlow(m, sq.goal, sq.route) : pointFlow(m, sq.goal);
}

/** The wedge slot of the `n`th living member (0 = the leader), `scale` its seeded spread. */
export function wedgeSlot(m: Match, L: Soldier, n: number, scale: number): Vec2 {
  const rank = Math.ceil(n / 2);
  const back = m.tune.wedgeBackM * rank * scale;
  const right = m.tune.wedgeSideM * rank * scale * (n % 2 ? -1 : 1);
  return { x: L.x - L.fx * back + L.fy * right, y: L.y - L.fy * back - L.fx * right };
}

/** Sends `s` to a spot (with or without a path already found); null = back to following its Squad. */
export function setDest(m: Match, s: Soldier, d: { at: Vec2; path: Vec2[] } | Vec2 | null) {
  if (!d) {
    s.dest = null;
    s.path = [];
  } else if ('at' in d) {
    s.dest = d.at;
    s.path = d.path;
  } else {
    s.dest = d;
    s.path = lineWalk(m, s, d) ? [] : (localPath(m, s, d) ?? []);
  }
}

/** An enemy inside the point, or in the Squad's memory near it. */
const threatened = (m: Match, sq: Squad, p: Point) => insideCount(m, p, enemyOf(sq.side)) > 0 || sq.memory.some((c) => dist2(c, p) < sq2(p.radius + m.tune.threatenedM));

/** #120: a self-chosen Commitment to `goal` still holds: not over, the point not its own Side's, no own point near `from` threatened. */
function committed(m: Match, sq: Squad, goal: number, until: number, from: Vec2): boolean {
  const p = m.points[goal];
  if (!p || m.tick >= until || p.owner === sq.side) return false;
  return !m.points.some((o) => o.owner === sq.side && dist2(from, o) < sq2(m.tune.commitThreatM) && threatened(m, sq, o));
}

/** #120: the tick a Commitment made now ends, seeded between `commitSeconds`. */
const commitEnd = (m: Match) => m.tick + Math.round((m.tune.commitSeconds[0] + (m.tune.commitSeconds[1] - m.tune.commitSeconds[0]) * rnd(m)) * m.tune.hz);

/**
 * The Capture Point seen from `from` that the Squad takes, -1 = none: value by owner (enemy points x its aggression), path
 * distance, crowding (pairing up on enemy points), its seeded preference, stickiness plus `pull` on the Squad's goal, the
 * Order's bonus. #120: it draws among the points within `choiceMargin` of the best, weighted by how far each clears best minus
 * the margin. #107: a driver scores by `flow` (its drive grid) and adds its own `bias` per point, and takes the best.
 */
export function bestPoint(m: Match, sq: Squad, from: Vec2, pull = 0, own: { flow?: (i: number) => Flow; bias?: number[] } = {}): number {
  const t = m.tune;
  const foe = enemyOf(sq.side);
  const scores: number[] = [];
  m.points.forEach((p, i) => {
    let v =
      p.owner === null ? t.pointValue.neutral
      : p.owner === foe ? t.pointValue.enemy * (own.flow ? 1 : 1 + sq.aggression * t.aggressionValueMul)
      : threatened(m, sq, p) ? t.pointValue.ownedThreatened
      : t.pointValue.ownedQuiet;
    v -= (t.distancePenaltyPer100m * flowDist(m, (own.flow ?? ((k) => pointFlow(m, k)))(i), from)) / 100;
    v += own.bias?.[i] ?? (own.flow ? 0 : sq.pref[i] ?? 0);
    const others = m.squads.filter((o) => o !== sq && o.side === sq.side && o.task === 'point' && o.goal === i).length;
    v -= p.owner === foe ? (others === 1 ? -t.pairUp : t.crowdPenalty * Math.max(0, others - 1)) : t.crowdPenalty * others;
    if (sq.task === 'point' && sq.goal === i) v += t.stickiness + pull;
    if (sq.order?.point === i) v += t.orderBonus;
    scores.push(v);
  });
  const top = Math.max(...scores);
  if (own.flow || !scores.length) return scores.indexOf(top);
  const floor = top - t.choiceMargin;
  const weights = scores.map((v) => Math.max(0, v - floor));
  let r = rnd(m) * weights.reduce((a, w) => a + w, 0);
  const pick = weights.findIndex((w) => w > 0 && (r -= w) < 0);
  return pick < 0 ? scores.indexOf(top) : pick;
}

export function think(m: Match, sq: Squad, events: SimEvent[]) {
  const t = m.tune;
  const members = membersOf(m, sq);
  const alive = members.filter((s) => s.state === 'alive');
  const leader = alive[0]; // #106: the Squad scores from its Squad Leader (member 0) while alive, wherever they are
  if (!leader) {
    sq.task = 'none';
    return;
  }
  const lead = { ...leader, ...nearestWalkable(m, leader) }; // #109: from the ground under them when they fly over a roof or the river
  const foot = alive.filter((s) => s.vehicle < 0); // #107
  if (foot.length && foot.every((s) => s.detached)) Object.assign(foot[0]!, { detached: false, goal: -1 }); // someone on foot is always the Squad's body
  const body = foot.filter((s) => !s.detached); // #106: the members moving as one
  const L = body[0] ?? leader; // the foot leader: the wedge forms on them; with everyone aboard, the Squad Leader's vehicle stands in
  const foe = enemyOf(sq.side);
  let threat: Vec2 | null = null;
  for (const c of sq.memory) if (!threat || dist2(c, L) < dist2(threat, L)) threat = c;
  const inContact = sq.memory.some((c) => m.tick - c.tick < t.contactSeconds * t.hz) || body.some((s) => s.suppression > t.suppressedAt);

  // survival outranks everything; a Detached member's fight is its own, so only the body's fire and ammo count (the headcount stays the Squad's)
  const retreatAt = Math.min(0.99, t.retreatSuppression * (1 + sq.aggression * t.aggressionRetreatMul)); // #120: bold falls back later
  const shaken = body.filter((s) => s.suppression > retreatAt).length;
  const dry = body.filter((s) => s.ammo < t.ammoLow).length;
  let survive: 'retreat' | 'resupply' | null = null;
  if (sq.task === 'retreat') survive = quiet(m, sq, members) && alive.length >= members.length - 1 ? null : 'retreat';
  else if ((alive.length <= 1 && members.length >= 3) || (body.length >= 2 && shaken * 2 > body.length)) survive = 'retreat';
  if (!survive) {
    if (sq.task === 'resupply') survive = body.every((s) => s.ammo >= t.ammo * t.ammoRefilled) ? null : 'resupply';
    else if (dry * 2 > body.length) survive = 'resupply';
  }

  // #120: a Commitment ends early on an Order (arriving or cleared) or a survival task, as well as on its own events
  if (sq.order || survive) sq.commitUntil = 0;
  const held = sq.task === 'point' && committed(m, sq, sq.goal, sq.commitUntil, lead);
  let best = survive ? -1 : held ? sq.goal : bestPoint(m, sq, lead);
  if (sq.order) best = sq.order.point; // an Order is never lost to a better-scoring point, whatever the distance
  else if (!survive && !held && best >= 0) sq.commitUntil = commitEnd(m);

  const prevTask = sq.task;
  const prevGoal = sq.goal;
  if (survive) {
    if (prevTask !== survive) {
      let goal = -1; // the HQ, unless Retreat finds an owned, uncontested point that is not the one it is on
      let near = Infinity;
      if (survive === 'retreat')
        m.points.forEach((p, i) => {
          if (p.owner !== sq.side || insideCount(m, p, foe) > 0 || dist2(lead, p) <= sq2(p.radius + 20)) return;
          const d = flowDist(m, pointFlow(m, i), lead);
          if (d < near) [near, goal] = [d, i];
        });
      Object.assign(sq, { task: survive, goal, route: -1 });
    }
  } else if (best < 0) sq.task = 'none';
  else {
    if (prevTask !== 'point' || prevGoal !== best) chooseRoute(m, sq, L, best);
    Object.assign(sq, { task: 'point', goal: best });
  }

  // movement mode
  const goal = goalOf(m, sq);
  let mode: Squad['mode'] = 'travel';
  if (goal) {
    const dL = Math.sqrt(dist2(L, goal));
    const holding = sq.mode === 'hold' && prevTask === sq.task && prevGoal === sq.goal;
    if (sq.task === 'point') mode = (holding ? dL < goal.r * t.holdLeashMul + 4 : dL < goal.r - 4) ? 'hold' : inContact ? 'bound' : 'travel';
    else mode = dL < goal.r ? 'hold' : 'fallback';
  }
  if (mode !== sq.mode || prevTask !== sq.task || prevGoal !== sq.goal) {
    for (const s of body)
      if (!s.chaseUntil) {
        setDest(m, s, null);
        Object.assign(s, { cover: null, role: null, strayUntil: 0, holdUntil: m.tick + Math.round(s.reaction * t.hz) }); // #121: sets off after its reaction
      }
    Object.assign(sq, { mode, phase: 1, phaseUntil: 0, holdAt: 0, flankSign: 0, flankSince: -1, flankDone: false });
  }
  const team = body.filter((s) => !s.chaseUntil);
  sq.slow = (mode === 'travel' || mode === 'fallback') && body.some((s, n) => n > 0 && !s.strayUntil && dist2(s, wedgeSlot(m, L, n, s.slot)) > 100); // #93: a stray is not waited for
  if (mode === 'hold' && goal) hold(m, sq, goal, threat, team, alive);
  else if (mode === 'bound' && goal) {
    const flow = flowOf(m, sq)!;
    if (threat && team.length >= 3 && !sq.flankDone && dist2(threat, L) < sq2(t.flankRangeM)) flank(m, sq, L, goal, threat, flow, team, alive, events);
    else bound(m, sq, threat, flow, team, alive);
  }
  soldierJobs(m, sq, L, goal, threat, foot);
  if ((mode === 'travel' || mode === 'fallback') && goal && dist2(L, goal) > sq2(goal.r + t.leashM)) stray(m, sq, L, body); // #93: closes up within a leash of the goal
  for (const s of foot) if (s.detached) detached(m, sq, L, s);
  for (const s of alive) if (s.vehicle >= 0) ride(m, sq, s); // #107
  decideRide(m, sq, body, L);
  for (const s of foot) if (s.vehicle < 0) board(m, sq, s);
}

/** #106: a Detached Soldier picks its own Capture Point, pulled toward the Squad's, and rejoins near the foot leader on the Squad's goal. */
function detached(m: Match, sq: Squad, L: Soldier, s: Soldier) {
  const t = m.tune;
  if (sq.task !== 'point' || sq.order) s.commitUntil = 0;
  const held = sq.task === 'point' && committed(m, sq, s.goal, s.commitUntil, s);
  const own = sq.task !== 'point' ? -1 : held ? s.goal : bestPoint(m, sq, s, t.squadPull); // survival calls them back to the Squad's goal
  const prev = s.goal;
  s.goal = own === sq.goal ? -1 : own;
  if (s.goal >= 0 && s.goal !== prev) s.holdUntil = m.tick + Math.round(s.reaction * t.hz); // #121
  if (!held && s.goal >= 0) s.commitUntil = commitEnd(m);
  if (s.goal < 0 && dist2(s, L) < sq2(t.rejoinM)) s.detached = false;
}

/**
 * #93: a travelling mate now and then leaves the wedge for a spot beside the Squad's line ahead, then walks its own line
 * from there (soldier.ts) until its stray ends or the leash pulls it back (regroup, in soldierJobs); it rejoins the wedge
 * after either. Only the Simulation RNG, so replays hold.
 */
function stray(m: Match, sq: Squad, L: Soldier, alive: Soldier[]) {
  const t = m.tune;
  const flow = flowOf(m, sq);
  alive.forEach((s, n) => {
    if (s === L || s.chaseUntil) return;
    if (s.strayUntil && m.tick >= s.strayUntil) {
      if (s.regroup) return; // walking back; `strayUntil` stays set so the leader does not wait for it and it does not stray again yet
      if (s.dest) setDest(m, s, null);
      if (dist2(s, L) > sq2(t.detachM)) {
        Object.assign(s, { detached: true, strayUntil: 0, cover: null, role: null }); // #106: too far to come back; picks its own goal below
        return;
      }
      if (dist2(s, L) > sq2(22)) {
        // too far for the wedge to take it (soldier.ts): walks back behind the leader like a straggler, the regroup rule above keeps it going
        Object.assign(s, { regroup: true, cover: null });
        setDest(m, s, { x: L.x - L.fx * 5, y: L.y - L.fy * 5 });
        return;
      }
      if (dist2(s, wedgeSlot(m, L, n, s.slot)) > 100) return; // the wedge walks it the last metres to its slot; still not waited for
      s.strayUntil = 0;
    }
    if (s.strayUntil || s.regroup || s.dest || !flow || rnd(m) >= t.strayChance) return;
    const ahead = flowLook(m, flow, L, 20) ?? L;
    const side = (t.strayM[0] + (t.strayM[1] - t.strayM[0]) * rnd(m)) * (rnd(m) < 0.5 ? -1 : 1);
    const spot = { x: ahead.x + L.fy * side, y: ahead.y - L.fx * side };
    if (!canStand(m, s, spot) || alive.some((o) => o !== s && dist2(o.dest ?? o, spot) < sq2(t.coverSpacingM))) return;
    s.strayUntil = m.tick + (t.straySeconds[0] + (t.straySeconds[1] - t.straySeconds[0]) * rnd(m)) * t.hz;
    setDest(m, s, spot);
  });
}

/** Cover in and around the point, facing the threat (or the enemy HQ); re-picked every `holdRepickSeconds` or when the threat moves round. */
function hold(m: Match, sq: Squad, goal: Vec2 & { r: number }, threat: Vec2 | null, team: Soldier[], alive: Soldier[]) {
  const t = m.tune;
  const enemyHq = m.map.hqs[enemyOf(sq.side)];
  const away = Math.sqrt(dist2(enemyHq, goal)) || 1;
  const th = threat && dist2(threat, goal) < sq2(150) ? threat : { x: goal.x + ((enemyHq.x - goal.x) / away) * 60, y: goal.y + ((enemyHq.y - goal.y) / away) * 60 };
  const o8 = oct(th.x - goal.x, th.y - goal.y);
  if (m.tick < sq.holdAt && o8 === sq.holdOct) return;
  sq.holdAt = m.tick + t.holdRepickSeconds * t.hz;
  sq.holdOct = o8;
  for (const s of team) setDest(m, s, null);
  const r = goal.r * t.holdLeashMul;
  for (const s of team) setDest(m, s, pickCover(m, s, alive, { at: goal, radius: r, leash: { around: goal, r, inside: goal.r - 3 }, threat: th }));
}

/** Pairs leapfrog: one pair runs to cover nearer the goal while the other stops and fires. */
function bound(m: Match, sq: Squad, threat: Vec2 | null, flow: Flow, team: Soldier[], alive: Soldier[]) {
  const t = m.tune;
  const movers = team.filter((_, n) => n % 2 === sq.phase);
  if (m.tick < sq.phaseUntil && !movers.every((s) => !s.dest || dist2(s, s.dest) < 1.44)) return;
  sq.phase ^= 1;
  sq.phaseUntil = m.tick + t.boundSeconds * t.hz;
  team.forEach((s, n) => {
    s.role = null;
    if (n % 2 !== sq.phase) return setDest(m, s, null);
    s.cover = null;
    setDest(m, s, pickCover(m, s, alive, { at: s, radius: t.coverRadiusM, progress: { flow, min: 4 }, threat: threat ?? undefined }) ?? flowLook(m, flow, s, 5));
  });
}

/** Even members hold and fire; odd members swing round the threat through cover. Ends at a `flankCos` swing or after `flankSeconds`. */
function flank(m: Match, sq: Squad, L: Soldier, goal: Vec2, th: Vec2, flow: Flow, team: Soldier[], alive: Soldier[], events: SimEvent[]) {
  const t = m.tune;
  if (sq.flankSince < 0) {
    sq.flankSince = m.tick;
    sq.phaseUntil = 0;
    // swing round the threat toward the goal's side: +1 counter-clockwise, which is right as seen from the Squad
    sq.flankSign = (L.x - th.x) * (goal.y - th.y) - (L.y - th.y) * (goal.x - th.x) >= 0 ? 1 : -1;
    const text = `flanking ${sq.flankSign > 0 ? 'right' : 'left'}`;
    events.push({ kind: 'radio', side: sq.side, squad: sq.id, type: 'flanking', text, ...(m.map.grid ? { grid: gridRef(m.map.grid, th) } : {}), priority: 1 });
  }
  const flankers = team.filter((_, n) => n % 2 === 1);
  const support = team.filter((_, n) => n % 2 === 0);
  const anchor = support[0]!;
  for (const s of support) {
    s.role = 'support';
    if (!s.dest && shelter(m, s, th) < 0.35) setDest(m, s, pickCover(m, s, alive, { at: s, radius: 10, threat: th }));
  }
  if (m.tick >= sq.phaseUntil || flankers.every((s) => !s.dest || dist2(s, s.dest) < 1.44)) {
    sq.phaseUntil = m.tick + t.boundSeconds * t.hz;
    for (const s of flankers) {
      Object.assign(s, { role: 'flank', cover: null });
      setDest(m, s, pickCover(m, s, alive, { at: s, radius: t.coverRadiusM, progress: { flow, min: -8 }, threat: th, flank: { from: anchor, sign: sq.flankSign } }));
    }
  }
  const ax = anchor.x - th.x;
  const ay = anchor.y - th.y;
  const swung = flankers.some((s) => {
    const bx = s.x - th.x;
    const by = s.y - th.y;
    return ax * bx + ay * by < t.flankCos * Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by));
  });
  if (swung || m.tick - sq.flankSince > t.flankSeconds * t.hz) {
    sq.flankDone = true;
    sq.phaseUntil = 0;
    for (const s of team) s.role = null;
  }
}

/** Peel-off chases (start and end), cover for the pinned, regrouping stragglers. */
function soldierJobs(m: Match, sq: Squad, L: Soldier, goal: (Vec2 & { r: number }) | null, threat: Vec2 | null, alive: Soldier[]) {
  const t = m.tune;
  const fighting = sq.mode === 'bound' || sq.mode === 'hold';
  const leash = sq.mode === 'hold' && goal ? { around: goal, r: goal.r * t.holdLeashMul, inside: 0 } : undefined;
  for (const s of alive)
    if (s.chaseUntil && (m.tick > s.chaseUntil || s.suppression > t.retreatSuppression || dist2(s, L) > sq2(t.leashM) || (leash && dist2(s, leash.around) > sq2(leash.r)))) {
      s.chaseUntil = 0;
      setDest(m, s, null);
    }
  for (const s of alive) {
    const lost = s.target < 0 && s.lastTarget >= 0 ? sq.memory.find((c) => c.id === s.lastTarget) : undefined;
    if (s.target < 0) s.lastTarget = -1;
    if (!lost || !fighting || s.detached || s.chaseUntil || s.hp <= t.hp / 2 || s.suppression >= 0.3 || alive.length < 3 || alive.some((o) => o.chaseUntil)) continue;
    if (dist2(lost, s) >= sq2(t.peelRangeM) || (leash && dist2(lost, leash.around) > sq2(leash.r))) continue;
    Object.assign(s, { chaseUntil: m.tick + t.peelSeconds * t.hz, cover: null, role: null });
    setDest(m, s, pickCover(m, s, alive, { at: lost, radius: 14, threat: lost, leash }) ?? { x: lost.x, y: lost.y });
  }
  for (const s of alive) {
    if (sq.mode !== 'fallback' && !s.cover && s.suppression > t.pinnedAt && s.reviving < 0) {
      const th = m.soldiers[s.target] ?? threat;
      const c = th && shelter(m, s, th) < 0.35 ? pickCover(m, s, alive, { at: s, radius: 10, threat: th }) : null;
      if (c && th && shelter(m, c.at, th) > shelter(m, s, th)) Object.assign(s, { cover: c.at, path: c.path });
    }
    if (s.cover && s.suppression < 0.25 && dist2(s, s.cover) < 1) s.cover = null;
  }
  for (const s of alive) {
    if (s === L || s.chaseUntil || s.detached) {
      s.regroup = false;
      continue;
    }
    const d2 = dist2(s, L);
    if (d2 > sq2(t.leashM) || (s.regroup && d2 >= sq2(15))) {
      Object.assign(s, { regroup: true, cover: null });
      setDest(m, s, { x: L.x - L.fx * 5, y: L.y - L.fy * 5 });
    } else if (s.regroup) {
      s.regroup = false;
      setDest(m, s, null);
    }
  }
}
