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

/** Four Squads a Side, nobody sees anybody and nobody carries rockets; nato Squad 0 is Ordered to D across the river, pact Squad 4 to C on the bridge. */
function run(seconds: number) {
  const m: Match = createMatch({ seed: 3, map: KALTENBACH, tune: { ...DEFAULT_TUNE, visionM: 0, rockets: 0 }, squadsPerSide: 4, commanderSide: 'nato' });
  const orders: Command[] = [
    { tick: 0, side: 'nato', kind: 'order', squad: 0, point: 'D' },
    { tick: 0, side: 'pact', kind: 'order', squad: 4, point: 'C' },
  ];
  const track: { x: number; y: number; road: boolean }[][] = [[], []];
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

  it('each tank waits in its HQ vehicle park, and two Soldiers board it at match start', () => {
    m.vehicles.forEach((v) => expect(v.slot).toEqual(KALTENBACH.vehicleSlots![v.side]));
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
    const [nato, pact] = track;
    const moving = (t: typeof nato) => t!.filter((p, i) => i > 0 && (p.x !== t![i - 1]!.x || p.y !== t![i - 1]!.y));
    for (const t of [nato, pact]) expect(moving(t).filter((p) => p.road).length / moving(t).length).toBeGreaterThan(0.5);
    const d = m.points.find((p) => p.id === 'D')!;
    const c = m.points.find((p) => p.id === 'C')!;
    expect(Math.hypot(pact!.at(-1)!.x - c.x, pact!.at(-1)!.y - c.y)).toBeLessThan(c.radius);
    expect(m.vehicles[1]!.parked).toBe(true);
    expect(m.vehicles[1]!.seats.every((id) => id >= 0)).toBe(true); // the crew fight from it (C is contested by nato's infantry)
    expect(Math.hypot(nato!.at(-1)!.x - d.x, nato!.at(-1)!.y - d.y)).toBeLessThan(d.radius);
  });
});
