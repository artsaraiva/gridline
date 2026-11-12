/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMatch, SIDES } from '../sim';
import { across, build, crossingFlow, flowBytes, flowDist, pointFlow, warmFlows } from '../sim/ai/flow';
import { COVER, WALL, WATER, walkCost, cellAt, cellIndex, nearestWalkable } from '../sim/grid';
import { DEFAULT_TUNE } from '../sim/tune';
import { insidePolygon } from '../sim/geometry';
import type { BakedMap } from './baked';
import { readBake } from './bake-check';
import { terrainOf } from './load';

const DIR = new URL('../../public/maps/kaltenbach/', import.meta.url);
const meta: BakedMap = JSON.parse(readFileSync(new URL('map.json', DIR), 'utf8'));
const cover = new Uint8Array(readFileSync(new URL(meta.data.cover, DIR)));
const ids = meta.data.coverIds;

/** The 1 m data cell holding world point (x, y): row 0 north. */
const at1m = (x: number, y: number) => cover[Math.floor(meta.sizeM / 2 - y) * meta.data.cells + Math.floor(x + meta.sizeM / 2)]!;

const map = { ...meta, terrain: terrainOf(meta, cover, DEFAULT_TUNE.cellM) };
const match = () => createMatch({ seed: 1, map, tune: DEFAULT_TUNE, squadsPerSide: 4, commanderSide: 'nato' });
const find = (id: number, step = 7) => {
  for (let y = -440; y < 440; y += step) for (let x = -440; x < 440; x += step) if (insidePolygon(meta.playArea, x, y) && at1m(x, y) === id && at1m(x + 1, y + 1) === id && at1m(x - 1, y - 1) === id) return { x, y };
  throw new Error(`no cover id ${id}`);
};

describe('map loader: 1 m bake data to the Simulation\'s 2 m cells', () => {
  it('covers the whole 960 m map in 480 x 480 cells', () => {
    const t = map.terrain;
    expect([t.cols, t.rows, t.cellM, t.x0, t.y0]).toEqual([480, 480, 2, -480, -480]);
    expect(t.cells.length).toBe(480 * 480);
  });

  it('turns buildings into walls, hedges and woods into cover, the river into water and the ford into wading', () => {
    const m = match();
    const b = find(ids.building!);
    expect(cellAt(m, b.x, b.y)).toBe(WALL);
    expect(walkCost(m, b.x, b.y)).toBe(0);
    // a hedge is one metre wide, so a 2 m cell takes it when half of the cell is hedge; woods are broad
    for (const [id, least] of [[ids.hedge!, 0.6], [ids.woods!, 0.9]] as const) {
      let all = 0, kept = 0;
      for (let y = -440; y < 440; y++)
        for (let x = -440; x < 440; x++)
          if (at1m(x, y) === id) {
            all++;
            if (cellAt(m, x, y) === COVER) kept++;
          }
      expect(all).toBeGreaterThan(0);
      expect(kept / all, `cover id ${id}`).toBeGreaterThan(least);
    }
    const w = find(ids.water!);
    expect(cellAt(m, w.x, w.y)).toBe(WATER);
    expect(walkCost(m, w.x, w.y)).toBe(0);
    const f = find(ids.ford!, 1);
    expect(walkCost(m, f.x, f.y)).toBe(20); // half speed
    expect(walkCost(m, 100, 300)).toBe(10);
  });

  it('is mostly walkable inside both HQs and every Capture Point and nowhere outside the Play Area', () => {
    const m = match();
    const walkable = (c: { x: number; y: number }, r: number) => {
      let all = 0, ok = 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (dx * dx + dy * dy <= r * r) (all++, walkCost(m, c.x + dx, c.y + dy) > 0 && ok++);
      return ok / all;
    };
    for (const side of SIDES) expect(walkable(m.map.hqs[side], 35), side).toBeGreaterThan(0.7);
    for (const p of m.map.points) expect(walkable(p, 25), p.id).toBeGreaterThan(0.4);
    for (let y = -480; y < 480; y += 6)
      for (let x = -480; x < 480; x += 6) {
        // cells are 2 m: a point is only certainly out when the cell around it is
        const out = [[0, 0], [2, 2], [-2, 2], [2, -2], [-2, -2]].every(([dx, dy]) => !insidePolygon(m.map.playArea, x + dx!, y + dy!));
        if (out) expect(walkCost(m, x, y)).toBe(0);
      }
  });

  it('finds ground to stand on beside a Capture Point that sits in a building', () => {
    const m = match();
    const a = m.map.points.find((p) => p.id === 'A')!;
    expect(walkCost(m, a.x, a.y)).toBe(0);
    const at = nearestWalkable(m, a);
    expect(walkCost(m, at.x, at.y)).toBeGreaterThan(0);
    expect(Math.hypot(at.x - a.x, at.y - a.y)).toBeLessThan(10);
  });

  it('#107: writes the ground-vehicle drive cost: road 10, open 20, ford 30; hedges, woods, buildings, walls, water and footbridges blocked', () => {
    const t = map.terrain;
    const drive = (x: number, y: number) => t.drive[Math.floor((y - t.y0) / t.cellM) * t.cols + Math.floor((x - t.x0) / t.cellM)]!;
    const r = find(ids.road!);
    expect(drive(r.x, r.y)).toBe(10);
    expect(at1m(100, 300)).toBe(ids.open);
    expect(drive(100, 300)).toBe(20);
    const f = find(ids.ford!, 1);
    expect(drive(f.x, f.y)).toBe(30);
    for (const id of [ids.hedge!, ids.woods!, ids.building!, ids.water!]) {
      const b = find(id);
      expect(drive(b.x, b.y), `cover id ${id}`).toBe(0);
    }
    expect(drive(5, 0), 'the road bridge').toBe(10);
    for (const c of meta.crossings.filter((c) => c.kind === 'footbridge')) expect(drive(c.x, c.y), c.id).toBe(0);
  });

  it('opens the river only at the five crossings, each one on its own', () => {
    const m = match();
    const from = m.map.hqs.nato;
    const east = m.points.find((p) => p.id === 'E')!;
    const over = (c: number) => build(m, m.grid, east, east.radius - 6, (k) => m.grid.crossing[k]! >= 0 && m.grid.crossing[k] !== c); // every crossing but `c` closed
    expect(flowDist(m, over(-1), from), 'all crossings closed').toBe(Infinity);
    meta.crossings.forEach((c, i) => expect(flowDist(m, over(i), from), c.id).toBeLessThan(Infinity));
  });

  it('#151: a composed route (to the middle of the crossing, then the point\'s field) is as long as the old field over that crossing alone', () => {
    const m = match();
    const t = m.tune;
    let checked = 0;
    m.points.forEach((p, i) => {
      const r = Math.max(t.cellM, p.radius - 6);
      const olds = meta.crossings.map((_, ci) => build(m, m.grid, p, r, (k) => m.grid.crossing[k]! >= 0 && m.grid.crossing[k] !== ci));
      const bank = build(m, m.grid, p, r, (k) => m.grid.crossing[k]! >= 0); // every crossing closed: the point's own bank
      for (let y = -460; y < 480; y += 40)
        for (let x = -460; x < 480; x += 40) {
          const from = nearestWalkable(m, { x, y });
          if (flowDist(m, pointFlow(m, i), from) === Infinity || m.grid.crossing[cellIndex(m, from.x, from.y)]! >= 0) continue; // walled in, or on a deck
          const over = flowDist(m, bank, from) === Infinity;
          expect(across(m, i, from), `${p.id} across from ${x},${y}`).toBe(over);
          if (!over) continue; // on the point's bank: no route
          const was = olds.map((f) => flowDist(m, f, from));
          meta.crossings.forEach((c, ci) => {
            const at = `${p.id} over ${c.id} from ${x},${y}`;
            const now = flowDist(m, crossingFlow(m, ci), from) + flowDist(m, pointFlow(m, i), c);
            expect(now < Infinity, at).toBe(was[ci]! < Infinity);
            if (was[ci] === Infinity) return;
            // through the anchor rather than the best line over (up to half the deck's width), from a disc a cell round it, and with
            // other crossings' abutment cells open on the way on (the old field closed them, so walked round them)
            expect(Math.abs(now - was[ci]!), `${at}: ${now} against ${was[ci]}`).toBeLessThanOrEqual(c.halfWidth + 2 * t.cellM);
            checked++;
          });
        }
    });
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('#150: map loader on Auental', () => {
  it('opens the 20 m Auer only at the seven crossings, each one on its own', () => {
    const a = readBake('auental');
    const m = createMatch({ seed: 1, map: { ...a.map, terrain: terrainOf(a.map, a.cover, DEFAULT_TUNE.cellM) }, tune: DEFAULT_TUNE, squadsPerSide: 4, commanderSide: 'nato' });
    const { nato, pact } = m.map.hqs;
    const over = (c: number) => build(m, m.grid, pact, 30, (k) => m.grid.crossing[k]! >= 0 && m.grid.crossing[k] !== c); // every crossing but `c` closed
    expect(flowDist(m, over(-1), nato), 'all crossings closed').toBe(Infinity);
    a.map.crossings.forEach((c, i) => expect(flowDist(m, over(i), nato), c.id).toBeLessThan(Infinity));
  });

  it('#151: builds every flow field within 16 bits and 160 MB, each crossing and point reachable from both HQs', () => {
    const a = readBake('auental');
    const m = createMatch({ seed: 1, map: { ...a.map, terrain: terrainOf(a.map, a.cover, DEFAULT_TUNE.cellM) }, tune: DEFAULT_TUNE, squadsPerSide: 8, commanderSide: 'nato' });
    expect(m.vehicles.length).toBeGreaterThan(0); // so the drive fields are built too
    warmFlows(m); // throws on a field too long for 16 bits
    expect(flowBytes(m)).toBeLessThanOrEqual(160e6);
    for (const hq of Object.values(m.map.hqs)) {
      a.map.crossings.forEach((c, i) => expect(flowDist(m, crossingFlow(m, i), hq), c.id).toBeLessThan(Infinity));
      m.points.forEach((p, i) => expect(flowDist(m, pointFlow(m, i), hq), p.id).toBeLessThan(Infinity));
    }
  }, 60_000);
});
