import { describe, expect, it } from 'vitest';
import { bake, KALTENBACH } from '../../scripts/bakes';
import { across, driveFlow, flowDist, flowLook } from './ai/flow';
import { overCrossing, pickRoute, ROAD, VIA } from './vehicles/drive-route';
import { cellIndex } from './grid';
import { createMatch, stateHash, step, type Match } from './index';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import { DEFAULT_TUNE } from './tune';
import type { Tune, Vec2 } from './types';
import { drivePoint, type Vehicle } from './vehicles';

// Vehicle routes on the committed Kaltenbach bake: nobody sees anybody, so whatever a driver knows is what the test tells its Side.
const HZ = DEFAULT_TUNE.hz;
const QUIET = { ...DEFAULT_TUNE, ...NO_TRAITS, ...NO_TEMPO, visionM: 0, rockets: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0, jeepsPerSide: 0, pointJeeps: false };

/** A match run until a nato tank is under way with a long drive ahead, and that tank. */
function underWay(tune: Partial<Tune> = {}) {
  const m: Match = thinkOnId(createMatch({ seed: 10, map: KALTENBACH, tune: { ...QUIET, ...tune }, squadsPerSide: 4, commanderSide: 'nato' }));
  const far = (v: Vehicle) => v.goal >= 0 && v.speed > 0 && flowDist(m, driveFlow(m, 'nato', v.goal), v) > 300;
  for (let i = 0; i < 120 * HZ && !m.vehicles.some((v) => v.side === 'nato' && v.kind === 'tank' && far(v)); i++) step(m, []);
  return { m, v: m.vehicles.find((v) => v.side === 'nato' && v.kind === 'tank' && far(v))! };
}

/** `v`'s road from where it stands, a spot every few cells. */
function road(m: Match, v: Vehicle): Vec2[] {
  const out: Vec2[] = [];
  for (let p: Vec2 = v; ; ) {
    const q = flowLook(m, driveFlow(m, v.side, v.goal), p, 4, m.drive[v.side])!;
    if (Math.hypot(q.x - p.x, q.y - p.y) < 0.01) return out;
    out.push((p = q));
  }
}

/** `v`'s road runs over the deck at `c`. */
const roadPast = (m: Match, v: Vehicle, c: Vec2) => road(m, v).some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 12);

const enemySeenAt = (m: Match, at: Vec2) => m.squads.find((sq) => sq.side === 'nato')!.memory.push({ id: m.soldiers.find((s) => s.side === 'pact')!.id, ...at, tick: m.tick, source: 'seen' });
const wreckAt = (m: Match, at: Vec2, side: 'nato' | 'pact' = 'nato') => m.wrecks.push({ side, kind: 'tank', ...at, fx: 1, fy: 0, seen: false, tick: m.tick });

/** The spot on `v`'s road, well ahead and well short of its goal, with the most open ground round it: the bocage leaves no way round everywhere. */
function openStretch(m: Match, v: Vehicle): Vec2 {
  const g = m.drive.nato;
  const open = (c: Vec2) => {
    let n = 0;
    for (let y = -80; y <= 80; y += 4) for (let x = -80; x <= 80; x += 4) if (x * x + y * y < 6400 && g.cost[cellIndex(m, c.x + x, c.y + y)] === 20) n++;
    return n;
  };
  return road(m, v).slice(12, -25).reduce((a, b) => (open(b) > open(a) ? b : a));
}

const offRoad = (m: Match, v: Vehicle) => v.path.filter((p) => !roadCell(m, p)).length;
const roadCell = (m: Match, p: Vec2) => m.drive.nato.cost[cellIndex(m, p.x, p.y)] === 10;
const arrives = (m: Match, v: Vehicle) => {
  const goal = v.goal;
  for (let i = 0; i < 400 * HZ && flowDist(m, driveFlow(m, 'nato', goal), v) > 0; i++) step(m, []);
  return flowDist(m, driveFlow(m, 'nato', goal), v) === 0;
};

describe('vehicle routes', () => {
  it('a driver with nothing known along its road takes the road, with no detour, at every think', () => {
    const { m, v } = underWay();
    expect(v).toBeDefined();
    expect([v.route, v.path]).toEqual([ROAD, []]);
    const rng = m.rng;
    pickRoute(m, v);
    expect([v.route, v.path, m.rng]).toEqual([ROAD, [], rng]);
  });

  it('drives past a lone enemy seen on the road ahead, and round a crowd of them through the fields, and still gets there', () => {
    const lone = underWay({ driveCaution: [1, 1] });
    enemySeenAt(lone.m, openStretch(lone.m, lone.v));
    pickRoute(lone.m, lone.v);
    expect(lone.v.path.length).toBeGreaterThan(0);

    const { m, v } = underWay({ driveCaution: [1, 1], driveSeenS: 200 });
    const at = openStretch(m, v);
    enemySeenAt(m, at);
    pickRoute(m, v);
    expect(offRoad(m, v)).toBeGreaterThan(offRoad(lone.m, lone.v) + 15); // 8 s of danger is not worth the fields; 200 s is
    const exposed = (path: Vec2[]) => {
      const near = path.map((p) => 1 - ((p.x - at.x) ** 2 + (p.y - at.y) ** 2) / DEFAULT_TUNE.routeSeenRadiusM ** 2).filter((e) => e > 0);
      return near.reduce((n, e) => n + e, 0) / near.length;
    };
    expect(exposed(v.path)).toBeLessThan(exposed(lone.v.path)); // within its reach, farther from it on the whole
    for (let i = 1; i < v.path.length; i++) expect(Math.hypot(v.path[i]!.x - v.path[i - 1]!.x, v.path[i]!.y - v.path[i - 1]!.y)).toBeLessThan(3); // cell by cell
    let off = 0;
    for (let i = 0; i < 60 * HZ && v.path.length; i++) {
      step(m, []);
      if (!roadCell(m, v)) off++;
    }
    expect(v.path).toEqual([]); // driven to its end ...
    expect(off).toBeGreaterThan(3 * HZ); // ... through the fields
    expect(arrives(m, v)).toBe(true);
  });

  it('keeps the detour it is on at the next think', () => {
    const { m, v } = underWay({ driveSeenS: 200 });
    enemySeenAt(m, openStretch(m, v));
    pickRoute(m, v);
    expect(v.path.length).toBeGreaterThan(0);
    const [path, rng] = [[...v.path], m.rng];
    pickRoute(m, v);
    expect([v.path, m.rng]).toEqual([path, rng]);
  });

  it('an own Wreck on the road ahead is driven round; an enemy Wreck and an old one are not', () => {
    const { m, v } = underWay({ driveCaution: [1, 1], driveWreckS: 200 });
    const at = openStretch(m, v);
    wreckAt(m, at, 'pact');
    m.wrecks.push({ side: 'nato', kind: 'tank', ...at, fx: 1, fy: 0, seen: false, tick: m.tick - (DEFAULT_TUNE.routeLossSeconds + 1) * HZ });
    pickRoute(m, v);
    expect(v.path).toEqual([]);
    wreckAt(m, at);
    pickRoute(m, v);
    expect(offRoad(m, v)).toBeGreaterThan(15);
  });

  it('danger near the goal itself moves nobody: every way ends there', () => {
    const { m, v } = underWay({ driveSeenS: 200 });
    enemySeenAt(m, m.points[v.goal]!);
    pickRoute(m, v);
    expect([v.route, v.path]).toEqual([ROAD, []]);
  });

  it('with danger known along its road to a point across the water, a fresh driver may take another crossing (Auental: Kaltenbach has one way over for a vehicle)', () => {
    const m = createMatch({ seed: 1, map: bake('auental'), tune: { ...QUIET, driveSeenS: 1000 }, squadsPerSide: 4, commanderSide: 'nato' });
    const v = m.vehicles.find((o) => o.side === 'nato' && o.kind === 'tank')!;
    const p = m.points.findIndex((_, i) => across(m, i, v) && flowDist(m, driveFlow(m, 'nato', i), v) < Infinity);
    Object.assign(v, { goal: p, route: -1 });
    pickRoute(m, v);
    expect(v.route).toBe(ROAD); // nothing known: the road's crossing
    const decks = m.map.crossings!;
    const roadDeck = decks.find((c) => c.kind !== 'footbridge' && roadPast(m, v, c))!;
    expect(roadDeck).toBeDefined();
    enemySeenAt(m, roadDeck);
    v.route = -1;
    pickRoute(m, v);
    expect(v.route).toBeGreaterThanOrEqual(VIA);
    expect(decks[v.route - VIA]).not.toBe(roadDeck);
    expect(decks[v.route - VIA]!.kind).not.toBe('footbridge');
    Object.assign(v, { x: decks[v.route - VIA]!.x, y: decks[v.route - VIA]!.y });
    overCrossing(m, v);
    expect(v.route).toBe(ROAD); // over the deck, the road's field leads on
    expect(roadPast(m, v, roadDeck)).toBe(false);
  }, 30_000); // the real Auental bake: its drive fields take seconds to build

  it('a tank driver marks down a point where known enemy tanks outnumber the friendly ones going, and where its Side just lost a tank', () => {
    for (const tune of [{ tankOutgunnedPenalty: 100, tankWreckPenalty: 0 }, { tankOutgunnedPenalty: 0, tankWreckPenalty: 100 }]) {
      const { m, v } = underWay(tune);
      const s = m.soldiers[v.seats[0]!]!;
      const sq = m.squads[s.squad]!;
      const goal = drivePoint(m, sq, s, v);
      const p = m.points[goal]!;
      const foes = m.vehicles.filter((o) => o.side === 'pact' && o.kind === 'tank');
      if (tune.tankWreckPenalty) wreckAt(m, p);
      else foes.forEach((o) => sq.memory.push({ id: o.id, x: p.x, y: p.y, tick: m.tick, source: 'seen' }));
      expect(foes.length).toBeGreaterThan(1);
      expect(drivePoint(m, sq, s, v)).not.toBe(goal);
    }
  });

  it('the route, its detour, its next plan and a Wreck\'s tick are in the state hash', () => {
    const { m, v } = underWay();
    const h = stateHash(m);
    v.route = VIA;
    const h1 = stateHash(m);
    v.path = [{ x: 1, y: 2 }];
    const h2 = stateHash(m);
    v.path[0]!.y = 3;
    const h2b = stateHash(m);
    v.planAt = 7;
    const h2c = stateHash(m);
    wreckAt(m, v);
    const h3 = stateHash(m);
    m.wrecks.at(-1)!.tick++;
    expect(new Set([h, h1, h2, h2b, h2c, h3, stateHash(m)]).size).toBe(7);
  });
});
