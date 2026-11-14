// Which way a ground vehicle's driver takes to its Capture Point: over which crossing, and off the road through the fields
// round the danger its Side knows of.
import type { Match } from '../index';
import { across, crossingDriveFlow, driveFlow, flowDist, flowLook, type Flow } from '../ai/flow';
import { dist2 } from '../geometry';
import { cellCentre, cellIndex } from '../grid';
import { sideKnown } from '../memory';
import { rnd } from '../rng';
import type { Vec2, VehicleKind } from '../types';
import { live, SPECS, type Vehicle } from './body';

/** `Vehicle.route`: -1 not chosen yet (it drives its road), its road, or `VIA + c` over crossing `c` first. */
export const ROAD = 0;
export const VIA = 1;

export const GROUND: VehicleKind[] = ['tank', 'jeep', 'aa'];

/** A route's line is walked `STEP` flow cells at a time (never over a deck unseen) and sampled every `HOP` of those: 16 m on 2 m cells, well inside the danger radii. */
const STEP = 2;
const HOP = 4;
/** A driver plans a detour once danger lies this many samples ahead or nearer (some 300 m) ... */
const NEAR = 19;
/** ... to rejoin its route this many samples (some 80 m) past the last of it; danger farther on than that is another detour. */
const GAP = 5;
/** Cells a detour search opens at most: a millisecond or two, and room for a way some hundreds of metres round. */
const SEARCH = 30000;
/** A driver that has planned (a detour or none) plans again no sooner than this: the search is the dear part, and a driver does not change its mind every second. */
const PLAN_SECONDS = 6;
/** The search reads danger off a grid this many cells coarse (16 m on 2 m cells), summed once per search instead of per cell opened. */
const COARSE = 8;

const DI = [1, 1, 0, -1, -1, -1, 0, 1];
const DJ = [0, 1, 1, 1, 0, -1, -1, -1];
const FAR = 0x3fffffff;
let cost = new Int32Array(0);
let from = new Int32Array(0);
let heat = new Float64Array(0);
const touched: number[] = [];

/** The flow field `v`'s route follows this tick. */
export const routeFlow = (m: Match, v: Vehicle): Flow => (v.route >= VIA ? crossingDriveFlow(m, v.side, v.route - VIA) : driveFlow(m, v.side, v.goal));

/** Over its route's crossing, the last few metres to the middle of the deck: from there the road's own field leads on to the goal. */
export function overCrossing(m: Match, v: Vehicle) {
  if (v.route >= VIA && flowDist(m, routeFlow(m, v), v) <= 3 * m.tune.cellM) v.route = ROAD;
}

/**
 * On a detour, the cell `n` ahead on it (the last, with fewer left), having dropped the ones reached: those within a cell of
 * the hull, and those a few cells on that it has a straight line to (`seen`), so it rounds a corner and does not cut it. Null with no detour.
 */
export function alongPath(m: Match, v: Vehicle, n: number, seen: (p: Vec2) => boolean): Vec2 | null {
  const within = (i: number, r: number) => dist2(v, v.path[i]!) < r * r;
  for (let i = Math.min(5, v.path.length - 1); i >= 0; i--)
    if (within(i, m.tune.cellM) || (within(i, 2.5 * m.tune.cellM) && seen(v.path[i]!))) {
      v.path.splice(0, i + 1);
      break;
    }
  return v.path[Math.min(n, v.path.length) - 1] ?? null;
}

/**
 * `route` from where `v` stands to its goal: the seconds it takes at the vehicle's road and open speeds, and the line it runs
 * along, sampled every `HOP` cells, less the stretch near the goal (every way ends there, so its danger tells none apart and
 * there is no going round it); `most` samples are enough for a detour's look ahead. Null when it leads nowhere, or when past its crossing's deck the road turns back over another:
 * that crossing is no way to this goal.
 */
function line(m: Match, v: Vehicle, route: number, most = Infinity): { secs: number; pts: Vec2[] } | null {
  const g = m.drive[v.side];
  const goal = m.points[v.goal]!;
  const [roadMps, openMps] = [SPECS[v.kind].roadMps(m.tune), SPECS[v.kind].openMps(m.tune)];
  const end = goal.radius + m.tune.routeSeenRadiusM;
  const legs = route >= VIA ? [crossingDriveFlow(m, v.side, route - VIA), driveFlow(m, v.side, v.goal)] : [driveFlow(m, v.side, v.goal)];
  let p: Vec2 = v;
  let secs = 0;
  const pts: Vec2[] = [];
  for (const f of legs) {
    if (flowDist(m, f, p) === Infinity) return null;
    for (let n = 1; pts.length < most; n++) {
      const q = flowLook(m, f, p, STEP, g)!;
      const d = Math.sqrt(dist2(p, q));
      if (d < 0.01) break; // the field's end: `flowLook` only ever goes downhill
      const k = cellIndex(m, q.x, q.y);
      if (route >= VIA && f !== legs[0] && g.crossing[k]! >= 0 && g.crossing[k] !== route - VIA) return null;
      const c = g.cost[k] || 20;
      secs += d / (c === 10 ? roadMps : (openMps * 20) / c);
      if (n % HOP === 0 && dist2(q, goal) > end * end) pts.push(q);
      p = q;
    }
  }
  return { secs, pts };
}

/** A place `v`'s Side knows is dangerous to drive past: within `r` of it, worth `s` seconds of driving. */
interface Spot extends Vec2 {
  r: number;
  s: number;
}

/** Enemies the Side saw lately, and where its own died and its own ground vehicles were wrecked lately. */
function spots(m: Match, v: Vehicle): Spot[] {
  const t = m.tune;
  const recent = (tick: number, seconds: number) => m.tick - tick < seconds * t.hz;
  return [
    ...sideKnown(m, v.side).filter((s) => s.source === 'seen' && recent(s.tick, t.routeSeenSeconds)).map((s) => ({ x: s.x, y: s.y, r: t.routeSeenRadiusM, s: t.driveSeenS })),
    ...m.deaths.filter((d) => d.side === v.side && recent(d.tick, t.routeLossSeconds)).map((d) => ({ x: d.x, y: d.y, r: t.routeLossRadiusM, s: t.driveLossS })),
    ...m.wrecks.filter((w) => w.side === v.side && GROUND.includes(w.kind) && recent(w.tick, t.routeLossSeconds)).map((w) => ({ x: w.x, y: w.y, r: t.routeLossRadiusM, s: t.driveWreckS })),
  ];
}

const hot = (p: Vec2, at: Spot[]) => at.reduce((n, s) => n + (dist2(s, p) < s.r * s.r ? s.s : 0), 0);

/**
 * At its driver's think: `v`'s way to `v.goal`. With a fresh goal it picks its crossing (`pickCrossing`); then, not already on
 * a detour, it plans one when danger lies near ahead on its route (`detour`).
 */
export function pickRoute(m: Match, v: Vehicle) {
  if (v.goal < 0) return void Object.assign(v, { route: -1, path: [] });
  if (v.route >= 0 && (v.path.length || m.tick < v.planAt || v.parked)) return;
  const at = spots(m, v);
  if (v.route < 0) {
    v.path = [];
    pickCrossing(m, v, at);
  }
  if (at.length) detour(m, v, at);
}

/**
 * Sets `v.route` for a fresh goal: its road, unless the goal is across the water and danger is known along that road. Then each
 * crossing a vehicle can take is scored in seconds: the drive over it, plus the danger known along it, `driveMateS` per other
 * friendly vehicle taking it to the same point, plus seeded jitter; crossings more than `driveMaxDetourS` slower than the road's
 * are dropped. The road's fields are the only ones built until then, so a quiet match never pays for the others.
 */
function pickCrossing(m: Match, v: Vehicle, at: Spot[]) {
  const t = m.tune;
  v.route = ROAD;
  const road = line(m, v, ROAD);
  // ponytail: chosen once per goal; a driver already on its way to a crossing that turns dangerous only detours round it (`detour`). Re-pick here if armour keeps dying at one bridge
  if (!road || !road.pts.some((p) => hot(p, at)) || !across(m, v.goal, v)) return;
  let best = Infinity;
  (m.map.crossings ?? []).forEach((c, i) => {
    const l = c.kind === 'footbridge' ? null : line(m, v, VIA + i);
    if (!l || l.secs > road.secs + t.driveMaxDetourS) return;
    const r = l.secs < road.secs + 2 ? ROAD : VIA + i; // the crossing the road takes anyway
    const mates = m.vehicles.filter((o) => o !== v && o.side === v.side && GROUND.includes(o.kind) && live(o) && o.seats[0]! >= 0 && o.goal === v.goal && Math.max(o.route, ROAD) === r).length;
    const score = l.secs + at.reduce((n, s) => n + (l.pts.some((p) => dist2(s, p) < s.r * s.r) ? s.s : 0), 0) + t.driveMateS * mates + t.driveJitterS * (rnd(m) * 2 - 1);
    if (score < best) [best, v.route] = [score, r];
  });
}

/**
 * Sets `v.path` when danger lies within `NEAR` samples ahead on its route: the cheapest way over the drive grid from where it
 * stands to the route `GAP` samples past the last of that danger. A cell costs its drive cost (so the road still pulls) plus, per
 * dangerous place it lies within reach of, what `s` seconds of road driving spread over that place's width come to (most at
 * its middle, nothing at its rim: a wide berth is worth more than a narrow one), times the driver's seeded caution: a lone rifleman is driven past, a Wreck or a crowd is driven round, through the fields if need be.
 * A* with the flow fields' step costs, at most `SEARCH` cells: no way found, no detour. Either way the driver plans no more for
 * `PLAN_SECONDS` (`v.planAt`).
 */
function detour(m: Match, v: Vehicle, at: Spot[]) {
  const t = m.tune;
  const l = line(m, v, Math.max(v.route, ROAD), NEAR + 8 * GAP);
  if (!l) return;
  const first = l.pts.findIndex((p) => hot(p, at));
  if (first < 0 || first > NEAR) return;
  let last = first;
  for (let i = first + 1; i < l.pts.length && i - last <= GAP; i++) if (hot(l.pts[i]!, at)) last = i;
  const to = l.pts[Math.min(l.pts.length - 1, last + GAP)]!;
  v.planAt = m.tick + Math.round(PLAN_SECONDS * t.hz);
  const g = m.drive[v.side];
  const { cols, rows } = g;
  const caution = t.driveCaution[0] + rnd(m) * (t.driveCaution[1] - t.driveCaution[0]);
  const perSecond = SPECS[v.kind].roadMps(t) * 5 * caution; // a road cell costs 10 and takes cellM / roadMps seconds; a place's seconds are spread over its 2 r of road: x its seconds / its radius
  const reach = Math.max(...at.map((s) => s.r));
  const span = Math.sqrt(dist2(v, to)) + 400; // ponytail: only danger this near the two ends weighs on the search; widen if detours start running into trouble farther out
  const close = at.filter((s) => dist2(s, v) < (span + reach) ** 2 && dist2(s, to) < (span + reach) ** 2).map((s) => ({ ...s, w: (1.5 * perSecond * s.s) / s.r })); // x 1.5: the fall-off below averages two thirds across the width
  const start = cellIndex(m, v.x, v.y);
  const goal = cellIndex(m, to.x, to.y);
  if (start < 0 || goal < 0 || start === goal) return;
  const [hc, hr] = [Math.ceil(cols / COARSE), Math.ceil(rows / COARSE)];
  if (cost.length !== cols * rows) [cost, from, heat] = [new Int32Array(cols * rows).fill(FAR), new Int32Array(cols * rows), new Float64Array(hc * hr)];
  for (const k of touched) cost[k] = FAR; // only what the last search opened
  touched.length = 0;
  heat.fill(0);
  const cm = COARSE * t.cellM;
  for (const s of close)
    for (let j = Math.max(0, Math.floor((s.y - s.r - g.y0) / cm)); j < Math.min(hr, Math.ceil((s.y + s.r - g.y0) / cm)); j++)
      for (let i = Math.max(0, Math.floor((s.x - s.r - g.x0) / cm)); i < Math.min(hc, Math.ceil((s.x + s.r - g.x0) / cm)); i++) {
        const [dx, dy] = [g.x0 + (i + 0.5) * cm - s.x, g.y0 + (j + 0.5) * cm - s.y];
        heat[j * hc + i]! += Math.max(0, s.w * (1 - (dx * dx + dy * dy) / (s.r * s.r)));
      }
  const [gi, gj] = [goal % cols, (goal / cols) | 0];
  const ahead = (k: number) => {
    const [di, dj] = [Math.abs((k % cols) - gi), Math.abs(((k / cols) | 0) - gj)];
    return 100 * Math.max(di, dj) + 40 * Math.min(di, dj); // the cheapest there could be: road all the way
  };
  // a binary heap of f * 2^21 + cell: whole numbers well inside a double, so ties break the same on every engine
  const CELLS = 2097152;
  const heap: number[] = [ahead(start) * CELLS + start];
  cost[start] = 0;
  touched.push(start);
  for (let opened = 0; heap.length && opened < SEARCH; opened++) {
    const top = heap[0]!;
    const tail = heap.pop()!;
    for (let i = 0; heap.length; ) {
      const a = 2 * i + 1;
      const b = a + 1;
      const c = b < heap.length && heap[b]! < heap[a]! ? b : a;
      if (a >= heap.length || heap[c]! >= tail) {
        heap[i] = tail;
        break;
      }
      heap[i] = heap[c]!;
      i = c;
    }
    const k = top % CELLS;
    if ((top - k) / CELLS > cost[k]! + ahead(k)) continue; // since lowered
    if (k === goal) {
      const path: Vec2[] = [];
      for (let c = goal; c !== start; c = from[c]!) path.push(cellCentre(m, c));
      v.path = path.reverse();
      return;
    }
    const i = k % cols;
    const j = (k / cols) | 0;
    for (let q = 0; q < 8; q++) {
      const ni = i + DI[q]!;
      const nj = j + DJ[q]!;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (!g.cost[nk]) continue;
      const diag = q & 1;
      if (diag && (!g.cost[j * cols + ni] || !g.cost[nj * cols + i])) continue; // no corner cutting
      const nd = cost[k]! + Math.round(g.cost[nk]! + heat[((nj / COARSE) | 0) * hc + ((ni / COARSE) | 0)]!) * (diag ? 14 : 10);
      if (nd >= cost[nk]!) continue;
      if (cost[nk] === FAR) touched.push(nk);
      cost[nk] = nd;
      from[nk] = k;
      let h = heap.push(0) - 1;
      const key = (nd + ahead(nk)) * CELLS + nk;
      for (; h > 0 && heap[(h - 1) >> 1]! > key; h = (h - 1) >> 1) heap[h] = heap[(h - 1) >> 1]!;
      heap[h] = key;
    }
  }
}
