/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KALTENBACH } from '../../scripts/kaltenbach';
import { createMatch, step, type Match } from './index';
import { driveFlow, flowDist } from './ai/flow';
import { cellCentre, cellIndex } from './grid';
import { DEFAULT_TUNE, NO_TRAITS } from './tune';
import type { Command } from './types';

// #107 on the committed Kaltenbach bake: the vehicles' roads, crossings and no-go ground, read off the 1 m cover grid; #108 the jeep;
// #109 the transport helicopter (the ground runs leave it out: it would take Soldiers off the roads).
const HZ = DEFAULT_TUNE.hz;
const cover = new Uint8Array(readFileSync(new URL(`../../public/maps/kaltenbach/${KALTENBACH.data.cover}`, import.meta.url)));
const ids = KALTENBACH.data.coverIds;
const at1m = (x: number, y: number) => cover[Math.floor(KALTENBACH.sizeM / 2 - y) * KALTENBACH.data.cells + Math.floor(x + KALTENBACH.sizeM / 2)]!;
const NO_GO = new Set([ids.hedge, ids.woods, ids.building, ids.wall, ids.water]);

/** Four Squads a Side, nobody sees anybody and nobody carries rockets; nato Squad 0 is Ordered to D across the river, pact Squad 7 to C on the bridge. */
function run(seconds: number) {
  const m: Match = createMatch({ seed: 5, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, visionM: 0, rockets: 0, helisPerSide: 0 }, squadsPerSide: 4, commanderSide: 'nato' });
  const orders: Command[] = [
    { tick: 0, side: 'nato', kind: 'order', squad: 0, point: 'D' },
    { tick: 0, side: 'pact', kind: 'order', squad: 7, point: 'C' }, // the first pact Squad to think: its two pairs take both tanks
  ];
  const track: { x: number; y: number; road: boolean }[][] = m.vehicles.map(() => []);
  const seats: number[][][] = [];
  for (let i = 0; i < seconds * HZ; i++) {
    step(m, orders.filter((c) => c.tick === m.tick));
    m.vehicles.forEach((v, k) => track[k]!.push({ x: v.x, y: v.y, road: at1m(v.x, v.y) === ids.road }));
    seats.push(m.vehicles.map((v) => [...v.seats]));
  }
  return { m, track, seats };
}

describe('#107 tanks on Kaltenbach', () => {
  const { m, track, seats } = run(300);

  it('two tanks a Side wait under the HQ vehicle park\'s camo nets, two jeeps beside them, and Soldiers board them all at match start; a jeep waits at every point but C', () => {
    const tanks = m.vehicles.filter((v) => v.kind === 'tank');
    expect(tanks.map((v) => [v.side, v.slot])).toEqual(['nato', 'nato', 'pact', 'pact'].map((side, k) => [side, KALTENBACH.vehicleSlots![side as 'nato']![k % 2]]));
    const hq = m.vehicles.filter((v) => v.point < 0);
    for (const j of hq.filter((v) => v.kind === 'jeep')) {
      const last = tanks.filter((v) => v.side === j.side).at(-1)!.slot;
      expect(Math.hypot(j.slot.x - last.x, j.slot.y - last.y)).toBeLessThan(25);
    }
    expect(hq.filter((v) => v.kind === 'jeep')).toHaveLength(4);
    hq.forEach((v) => {
      const s = seats[HZ]![m.vehicles.indexOf(v)]!;
      expect(v.kind === 'tank' ? s.every((id) => id >= 0) : s[0]! >= 0, `${v.kind} ${v.side}`).toBe(true); // tanks full, every jeep driven
    });
    expect(m.vehicles.filter((v) => v.point >= 0).map((v) => m.points[v.point]!.id)).toEqual(['A', 'B', 'D', 'E']);
  });

  it('never enters hedges, woods, buildings, walls, water, footbridges or the enemy HQ circle', () => {
    m.vehicles.forEach((v, k) => {
      const hq = KALTENBACH.hqs[v.side === 'nato' ? 'pact' : 'nato'];
      for (const p of track[k]!) {
        const road = m.drive[v.side].cost[cellIndex(m, p.x, p.y)] === 10; // a road cell takes a vehicle however close the hedges come (2 m cells)
        expect(!road && NO_GO.has(at1m(p.x, p.y)), `${v.kind} ${v.side} at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`).toBe(false);
        expect(Math.hypot(p.x - hq.x, p.y - hq.y)).toBeGreaterThan(hq.radius);
        for (const c of KALTENBACH.crossings.filter((c) => c.kind === 'footbridge')) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThan(8);
      }
    });
  });

  it('drives by road, crosses the river where it can (nato to D), and parks within the point it was sent to', () => {
    const moving = (t: (typeof track)[number]) => t.filter((p, i) => i > 0 && (p.x !== t[i - 1]!.x || p.y !== t[i - 1]!.y));
    for (const t of track) if (moving(t).length > 30 * HZ) expect(moving(t).filter((p) => p.road).length / moving(t).length).toBeGreaterThan(0.5);
    const drivenBy = (squad: number) => m.vehicles.find((v) => m.soldiers[v.seats[0]!]?.squad === squad)!;
    for (const [squad, id] of [[0, 'D'], [7, 'C']] as const) {
      const v = drivenBy(squad);
      const p = m.points.find((q) => q.id === id)!;
      expect(Math.hypot(v.x - p.x, v.y - p.y), `${v.side} tank to ${id}`).toBeLessThan(p.radius);
      expect(v.parked).toBe(true);
    }
  });

  it('no two matches send the tanks the same way: each driver brings its own seeded preference per point', () => {
    const goals = [1, 2, 3, 4].map((seed) => {
      const g = createMatch({ seed, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, helisPerSide: 0 }, squadsPerSide: 4, commanderSide: 'nato' });
      for (let i = 0; i < HZ; i++) step(g, []);
      return g.vehicles.filter((v) => v.point < 0).map((v) => g.points[v.goal]?.id).join('');
    });
    expect(new Set(goals).size, goals.join(" ")).toBeGreaterThan(2);
    expect(goals.every((g) => g.length === 8)).toBe(true); // every tank and HQ jeep has a driver and a point
  }, 20_000); // four fresh Kaltenbach matches, each building its flow fields

  it('reaches every Capture Point from both HQs: the hull margin keeps off hedges and walls, but not off the roads through them', () => {
    for (const side of ['nato', 'pact'] as const) {
      const slot = m.vehicles.find((v) => v.side === side)!.slot;
      m.points.forEach((p, i) => {
        const f = driveFlow(m, side, i);
        expect(flowDist(m, f, slot), `${side} to ${p.id}`).toBeLessThan(Infinity);
        const ends = [...f.keys()].filter((k) => f[k] === 0).map((k) => cellCentre(m, k));
        expect(ends.every((c) => Math.hypot(c.x - p.x, c.y - p.y) < p.radius), `${side} parks inside ${p.id}`).toBe(true);
      });
    }
  });
});

describe('#108 the jeep on Kaltenbach', () => {
  // No tanks: each Side's two jeeps wait in its HQ vehicle park; nobody sees anybody or carries rockets
  const m: Match = createMatch({ seed: 5, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, visionM: 0, rockets: 0, tanksPerSide: 0, helisPerSide: 0 }, squadsPerSide: 4, commanderSide: 'nato' });
  const jeeps = m.vehicles.filter((v) => v.kind === 'jeep' && v.point < 0);
  const crews = jeeps.map(() => [] as number[]);
  const exits: { side: string; id: number; tick: number; x: number; y: number; goal: number }[] = [];
  const road: boolean[][] = jeeps.map(() => []);
  for (let i = 0; i < 90 * HZ; i++) {
    const before = m.soldiers.map((s) => s.vehicle);
    step(m, []);
    jeeps.forEach((j, k) => {
      if (i === HZ) crews[k] = [...j.seats];
      if (j.movedAt === m.tick - 1) road[k]!.push(at1m(j.x, j.y) === ids.road);
    });
    for (const s of m.soldiers) {
      const j = jeeps.find((v) => v.id === before[s.id]);
      if (j && s.vehicle < 0) exits.push({ side: j.side, id: s.id, tick: m.tick, x: s.x, y: s.y, goal: j.goal });
    }
  }

  it('a Squad fills each jeep at match start, it reaches a Capture Point by road (one a Side in under a minute), and everyone gets out within dismountM of it', () => {
    jeeps.forEach((j, k) => {
      const crew = crews[k]!;
      expect(crew.every((id) => id >= 0), `${j.side} jeep full`).toBe(true);
      const squads = crew.map((id) => m.soldiers[id]!.squad);
      expect(squads.filter((q) => q === squads[0]).length, `${j.side}: one Squad, or three and a stray`).toBeGreaterThanOrEqual(3);
      const out = exits.filter((e, n) => crew.includes(e.id) && exits.findIndex((o) => o.id === e.id) === n); // each one's first ride
      expect(out.map((e) => e.id).sort()).toEqual([...crew].sort());
      for (const e of out) {
        const p = m.points[e.goal]!;
        expect(e.tick / HZ, `${j.side} Soldier ${e.id} out in time`).toBeLessThan(90); // the long way round, over the bridge, to the far side's B or D
        expect(Math.hypot(e.x - p.x, e.y - p.y), `${j.side} Soldier ${e.id} out near ${p.id}`).toBeLessThanOrEqual(DEFAULT_TUNE.dismountM + 1);
      }
      expect(road[k]!.filter(Boolean).length / road[k]!.length, `${j.side} by road`).toBeGreaterThan(0.5);
    });
    for (const side of ['nato', 'pact']) {
      const done = jeeps.map((j, k) => (j.side === side ? Math.max(...exits.filter((e) => crews[k]!.includes(e.id)).map((e) => e.tick)) : Infinity));
      expect(Math.min(...done) / HZ, `a ${side} jeep there and empty`).toBeLessThan(60);
    }
  });
});

describe('#109 the transport helicopter on Kaltenbach', () => {
  // Everything on, nobody sees anybody or carries rockets
  const m: Match = createMatch({ seed: 5, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, visionM: 0, rockets: 0 }, squadsPerSide: 4, commanderSide: 'nato' });
  const helis = m.vehicles.filter((v) => v.kind === 'helicopter');
  const flights = helis.map(() => ({ track: [] as { x: number; y: number }[], seats: [] as number[], landed: -1, lift: -1, lz: { x: 0, y: 0 } }));
  for (let i = 0; i < 120 * HZ; i++) {
    step(m, []);
    helis.forEach((h, k) => {
      const f = flights[k]!;
      if (f.landed < 0 && h.airborne) (f.track.push({ x: h.x, y: h.y }), f.seats.length || f.seats.push(...h.seats));
      if (f.landed < 0 && f.track.length && !h.airborne) Object.assign(f, { landed: m.tick, lz: { x: h.x, y: h.y } });
      if (f.landed >= 0 && f.lift < 0 && h.airborne) f.lift = m.tick;
    });
  }

  it('waits on its HQ\'s helipad; a Squad boards at match start, it flies straight over the river to a point on the other bank, lands inside it, unloads in unloadSeconds, and comes home to the pad', () => {
    helis.forEach((h, k) => {
      const f = flights[k]!;
      expect(h.slot).toEqual(KALTENBACH.helipad![h.side]);
      expect(f.seats.every((id) => id >= 0), `${h.side} full`).toBe(true);
      const p = m.points.find((q) => Math.hypot(f.lz.x - q.x, f.lz.y - q.y) < q.radius);
      expect(p, `${h.side} lands in a point`).toBeDefined();
      expect(Math.sign(f.track[0]!.x) !== Math.sign(f.lz.x) || f.lz.x === 0, `${h.side} crosses to ${p!.id}`).toBe(true);
      const [a, b] = [f.track[0]!, f.lz];
      for (const q of f.track) expect(Math.abs((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.5);
      expect(m.grid.cost[cellIndex(m, f.lz.x, f.lz.y)], `${h.side} sets down where a Soldier can stand`).toBeGreaterThan(0);
      expect((f.lift - f.landed) / HZ).toBeCloseTo(DEFAULT_TUNE.unloadSeconds, 0);
      expect(h).toMatchObject({ ...h.slot, airborne: false });
      expect(h.seats.slice(1)).toEqual([-1, -1, -1]);
      expect(f.seats.slice(1).every((id) => m.soldiers[id]!.vehicle !== h.id)).toBe(true);
    });
  });
});

