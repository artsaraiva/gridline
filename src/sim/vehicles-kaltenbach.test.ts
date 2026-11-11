/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KALTENBACH } from '../../scripts/kaltenbach';
import { createMatch, step, type Match } from './index';
import { driveFlow, flowDist } from './ai/flow';
import { cellCentre, cellIndex } from './grid';
import { DEFAULT_TUNE } from './tune';
import { NO_TEMPO, NO_TRAITS, thinkOnId } from './test-tune';
import type { Command } from './types';

// #107 on the committed Kaltenbach bake: the vehicles' roads, crossings and no-go ground, read off the 1 m cover grid; #108 the jeep;
// #109 the transport helicopter (the ground runs leave it out: it would take Soldiers off the roads).
const HZ = DEFAULT_TUNE.hz;
const cover = new Uint8Array(readFileSync(new URL(`../../public/maps/kaltenbach/${KALTENBACH.data.cover}`, import.meta.url)));
const ids = KALTENBACH.data.coverIds;
const at1m = (x: number, y: number) => cover[Math.floor(KALTENBACH.sizeM / 2 - y) * KALTENBACH.data.cells + Math.floor(x + KALTENBACH.sizeM / 2)]!;
const NO_GO = new Set([ids.hedge, ids.woods, ids.building, ids.wall, ids.water]);

/** The share of a trail's distance driven on road cells: "mostly by road" is about the route, not about how long the vehicle idles or crawls off road. */
const roadShare = (t: { x: number; y: number; road: boolean }[]) => {
  let on = 0, all = 0;
  t.forEach((p, i) => { const d = i ? Math.hypot(p.x - t[i - 1]!.x, p.y - t[i - 1]!.y) : 0; all += d; if (p.road) on += d; });
  return on / all;
};
const SEEDS = [10, 1, 2, 3, 4];

/** Four Squads a Side, nobody sees anybody and nobody carries rockets; nato Squad 0 is Ordered to D across the river, pact Squad 7 to C on the bridge. */
function run(seconds: number, seed = 10) {
  const m: Match = thinkOnId(createMatch({ seed, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, ...NO_TEMPO, visionM: 0, rockets: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0 }, squadsPerSide: 4, commanderSide: 'nato' }));
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
    const hq = m.vehicles.filter((v) => v.point < 0 && v.kind !== 'gunship'); // #101: the Gunship sleeps off the map until its Asset is called
    for (const j of hq.filter((v) => v.kind === 'jeep')) {
      const last = tanks.filter((v) => v.side === j.side).at(-1)!.slot;
      expect(Math.hypot(j.slot.x - last.x, j.slot.y - last.y)).toBeLessThan(25);
    }
    expect(hq.filter((v) => v.kind === 'jeep')).toHaveLength(4);
    hq.forEach((v) => {
      const s = seats[10 * HZ]![m.vehicles.indexOf(v)]!; // #122: Squads walk to the jeeps and climb in; tanks are crewed at once
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
    const drivenBy = (squad: number) => m.vehicles.find((v, k) => seats.some((s) => m.soldiers[s[k]![0]!]?.squad === squad))!; // #122: a Squad's jeep is empty again by the end
    for (const [squad, id] of [[0, 'D'], [7, 'C']] as const) {
      const v = drivenBy(squad);
      const p = m.points.find((q) => q.id === id)!;
      expect(Math.hypot(v.x - p.x, v.y - p.y), `${v.side} tank to ${id}`).toBeLessThan(p.radius);
      expect(v.parked).toBe(true);
    }
  });

  // Per seed, not pooled: a seed whose route leaves the roads is a route fault an average over the others would hide.
  it('drives mostly by road, by distance, in every one of several seeds', () => {
    for (const seed of SEEDS) {
      const r = seed === 10 ? { track } : run(300, seed);
      r.track.forEach((t, k) => { if (Number.isNaN(roadShare(t))) return; /* never left its slot */ expect(roadShare(t), `seed ${seed} vehicle ${k}`).toBeGreaterThan(0.5); });
    }
  }, 60_000);

  it('no two matches send the tanks the same way: each driver brings its own seeded preference per point', () => {
    const goals = [1, 2, 3, 4].map((seed) => {
      const g = thinkOnId(createMatch({ seed, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, ...NO_TEMPO, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0 }, squadsPerSide: 4, commanderSide: 'nato' }));
      for (let i = 0; i < 10 * HZ; i++) step(g, []);
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
  const m: Match = thinkOnId(createMatch({ seed: 10, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, ...NO_TEMPO, visionM: 0, rockets: 0, tanksPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0 }, squadsPerSide: 4, commanderSide: 'nato' }));
  const jeeps = m.vehicles.filter((v) => v.kind === 'jeep' && v.point < 0);
  const crews = jeeps.map(() => [] as number[]);
  const exits: { side: string; id: number; tick: number; x: number; y: number; goal: number }[] = [];
  for (let i = 0; i < 110 * HZ; i++) {
    const before = m.soldiers.map((s) => s.vehicle);
    step(m, []);
    jeeps.forEach((j, k) => {
      if (i === 10 * HZ) crews[k] = j.seats.filter((id) => id >= 0);
    });
    for (const s of m.soldiers) {
      const j = jeeps.find((v) => v.id === before[s.id]);
      if (j && s.vehicle < 0) exits.push({ side: j.side, id: s.id, tick: m.tick, x: s.x, y: s.y, goal: j.goal });
    }
  }

  it('a Squad fills each jeep at match start, it reaches a Capture Point by road (one a Side in under a minute), and everyone gets out within dismountM of it', () => {
    jeeps.forEach((j, k) => {
      const crew = crews[k]!;
      const squads = crew.map((id) => m.soldiers[id]!.squad);
      expect(squads.filter((q) => q === squads[0]).length, `${j.side}: one Squad's riders, two at least`).toBeGreaterThanOrEqual(2); // #122: whoever was there within boardWaitSeconds
      const out = exits.filter((e, n) => crew.includes(e.id) && exits.findIndex((o) => o.id === e.id) === n); // each one's first ride
      expect(out.map((e) => e.id).sort()).toEqual([...crew].sort());
      for (const e of out) {
        const p = m.points[e.goal]!;
        expect(e.tick / HZ, `${j.side} Soldier ${e.id} out in time`).toBeLessThan(105); // the long way round, over the bridge, to the far side's B or D; #123: measured 99 s; momentum's honest cost (a pull-away from rest, slowing for turns, a dismount stop braked to)
        expect(Math.hypot(e.x - p.x, e.y - p.y), `${j.side} Soldier ${e.id} out near ${p.id}`).toBeLessThanOrEqual(DEFAULT_TUNE.dismountM + 1);
      }
    });
    for (const side of ['nato', 'pact']) {
      const done = jeeps.map((j, k) => (j.side === side ? Math.max(...exits.filter((e) => crews[k]!.includes(e.id)).map((e) => e.tick)) : Infinity));
      expect(Math.min(...done) / HZ, `a ${side} jeep there and empty`).toBeLessThan(60);
    }
  });
});

describe('#108 the jeeps drive mostly by road', () => {
  // Per seed, not pooled (see #107): the jeeps' routes should hold whatever the seed
  it('by distance, in every one of several seeds', () => {
    for (const seed of SEEDS) {
      const m: Match = thinkOnId(createMatch({ seed, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, ...NO_TEMPO, visionM: 0, rockets: 0, tanksPerSide: 0, helisPerSide: 0, jetsPerSide: 0, aasPerSide: 0 }, squadsPerSide: 4, commanderSide: 'nato' }));
      const jeeps = m.vehicles.filter((v) => v.kind === 'jeep' && v.point < 0);
      const trails = jeeps.map(() => [] as { x: number; y: number; road: boolean }[]);
      for (let i = 0; i < 110 * HZ; i++) {
        step(m, []);
        jeeps.forEach((j, k) => trails[k]!.push({ x: j.x, y: j.y, road: at1m(j.x, j.y) === ids.road }));
      }
      trails.forEach((t, k) => { if (Number.isNaN(roadShare(t))) return; expect(roadShare(t), `seed ${seed} ${jeeps[k]!.side} jeep`).toBeGreaterThan(0.5); });
    }
  }, 60_000);
});

describe('#109 the transport helicopter on Kaltenbach', () => {
  // Everything on, nobody sees anybody or carries rockets
  const m: Match = thinkOnId(createMatch({ seed: 10, map: KALTENBACH, tune: { ...DEFAULT_TUNE, ...NO_TRAITS, ...NO_TEMPO, visionM: 0, rockets: 0, jetsPerSide: 0, aasPerSide: 0 }, squadsPerSide: 4, commanderSide: 'nato' }));
  const helis = m.vehicles.filter((v) => v.kind === 'helicopter');
  const flights = helis.map(() => ({ track: [] as { x: number; y: number }[], seats: [] as number[], landed: -1, lift: -1, lz: { x: 0, y: 0 } }));
  for (let i = 0; i < 160 * HZ; i++) { // #122: the Squad walks to it and climbs in first
    step(m, []);
    helis.forEach((h, k) => {
      const f = flights[k]!;
      if (f.landed < 0 && h.airborne) (f.track.push({ x: h.x, y: h.y }), f.seats.length || f.seats.push(...h.seats));
      if (f.track.length === 1) m.squads.forEach((sq) => sq.side === h.side && (sq.rideM = 1e9)); // #131: once it is off with its Squad no other calls it: this test is the trip and the way home
      if (f.landed < 0 && f.track.length && !h.airborne) Object.assign(f, { landed: m.tick, lz: { x: h.x, y: h.y } });
      if (f.landed >= 0 && f.lift < 0 && h.airborne) f.lift = m.tick;
    });
  }

  it('waits on its HQ\'s helipad; a Squad boards at match start, it flies a dogleg over the river to a point on the other bank, lands within lzM of it, unloads, spools, and comes home to the pad (#131: or goes on to Support a point)', () => {
    helis.forEach((h, k) => {
      const f = flights[k]!;
      expect(h.slot).toEqual(KALTENBACH.helipad![h.side]);
      expect(f.seats.filter((id) => id >= 0).length, `${h.side} crewed and carrying a Squad`).toBeGreaterThanOrEqual(3);
      const p = m.points.find((q) => Math.hypot(f.lz.x - q.x, f.lz.y - q.y) <= DEFAULT_TUNE.lzM[1] + 1);
      expect(p, `${h.side} lands within lzM of a point`).toBeDefined();
      expect(Math.hypot(f.lz.x - p!.x, f.lz.y - p!.y)).toBeGreaterThanOrEqual(DEFAULT_TUNE.lzM[0] - 1);
      expect(Math.sign(f.track[0]!.x) !== Math.sign(p!.x) || p!.x === 0, `${h.side} crosses to ${p!.id}`).toBe(true);
      const [a, b] = [f.track[0]!, f.lz];
      const off = f.track.map((q) => Math.abs((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y));
      expect(Math.max(...off), `${h.side} by a dogleg`).toBeGreaterThan(0.05 * Math.hypot(b.x - a.x, b.y - a.y));
      expect(m.grid.cost[cellIndex(m, f.lz.x, f.lz.y)], `${h.side} sets down where a Soldier can stand`).toBeGreaterThan(0);
      expect((f.lift - f.landed) / HZ).toBeCloseTo(DEFAULT_TUNE.unloadSeconds + DEFAULT_TUNE.spoolSeconds, 0);
      if (h.job === 'support') expect(h.airborne).toBe(true); // #131: with a gunner aboard and enemies known it now circles a point instead of going home
      else expect(h).toMatchObject({ ...h.slot, airborne: false });
      expect(h.seats.slice(3)).toEqual([-1, -1, -1]);
      expect(f.seats.slice(3).every((id) => id < 0 || m.soldiers[id]!.vehicle !== h.id)).toBe(true); // its passengers got out
    });
  });
});

