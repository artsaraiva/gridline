/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KALTENBACH } from '../../scripts/kaltenbach';
import { createMatch, step, type Match } from './index';
import { DEFAULT_TUNE } from './tune';
import type { Command } from './types';

// #107 on the committed Kaltenbach bake: the tanks' roads, crossings and no-go ground, read off the 1 m cover grid.
const HZ = DEFAULT_TUNE.hz;
const cover = new Uint8Array(readFileSync(new URL(`../../public/maps/kaltenbach/${KALTENBACH.data.cover}`, import.meta.url)));
const ids = KALTENBACH.data.coverIds;
const at1m = (x: number, y: number) => cover[Math.floor(KALTENBACH.sizeM / 2 - y) * KALTENBACH.data.cells + Math.floor(x + KALTENBACH.sizeM / 2)]!;
const NO_GO = new Set([ids.hedge, ids.woods, ids.building, ids.wall, ids.water]);

/** Four Squads a Side, nobody sees anybody and nobody carries rockets; nato Squad 0 is Ordered to D across the river, pact Squad 7 to C on the bridge. */
function run(seconds: number) {
  const m: Match = createMatch({ seed: 3, map: KALTENBACH, tune: { ...DEFAULT_TUNE, visionM: 0, rockets: 0 }, squadsPerSide: 4, commanderSide: 'nato' });
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

  it('two tanks a Side wait under the HQ vehicle park\'s camo nets, and Soldiers board them at match start', () => {
    expect(m.vehicles.map((v) => [v.side, v.slot])).toEqual(['nato', 'nato', 'pact', 'pact'].map((side, k) => [side, KALTENBACH.vehicleSlots![side as 'nato']![k % 2]]));
    for (const s of seats[HZ]!) expect(s.every((id) => id >= 0)).toBe(true);
  });

  it('never enters hedges, woods, buildings, walls, water, footbridges or the enemy HQ circle', () => {
    m.vehicles.forEach((v, k) => {
      const hq = KALTENBACH.hqs[v.side === 'nato' ? 'pact' : 'nato'];
      for (const p of track[k]!) {
        expect(NO_GO.has(at1m(p.x, p.y)), `${v.side} at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`).toBe(false);
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
      const g = createMatch({ seed, map: KALTENBACH, tune: DEFAULT_TUNE, squadsPerSide: 4, commanderSide: 'nato' });
      for (let i = 0; i < HZ; i++) step(g, []);
      return g.vehicles.map((v) => g.points[v.goal]?.id).join('');
    });
    expect(new Set(goals).size, goals.join(" ")).toBeGreaterThan(2);
    expect(goals.every((g) => g.length === 4)).toBe(true); // every tank has a driver and a point
  }, 20_000); // four fresh Kaltenbach matches, each building its flow fields
});
