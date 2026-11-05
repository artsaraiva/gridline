/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step, SIDES, type Match } from '../sim';
import { routeFlow, flowDist } from '../sim/ai/flow';
import { COVER, WALL, WATER, walkCost, cellAt } from '../sim/grid';
import { DEFAULT_TUNE } from '../sim/tune';
import { insidePolygon } from '../sim/geometry';
import type { BakedMap } from './baked';
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
    const b = find(ids.building);
    expect(cellAt(m, b.x, b.y)).toBe(WALL);
    expect(walkCost(m, b.x, b.y)).toBe(0);
    // a hedge is one metre wide, so a 2 m cell takes it when half of the cell is hedge; woods are broad
    for (const [id, least] of [[ids.hedge, 0.6], [ids.woods, 0.9]] as const) {
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
    const w = find(ids.water);
    expect(cellAt(m, w.x, w.y)).toBe(WATER);
    expect(walkCost(m, w.x, w.y)).toBe(0);
    const f = find(ids.ford, 1);
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

  it('opens the river only at the five crossings, each one on its own', () => {
    const m = match();
    const from = m.map.hqs.nato;
    const east = m.points.findIndex((p) => p.id === 'E');
    expect(flowDist(m, routeFlow(m, east, -1), from), 'all crossings closed').toBe(Infinity);
    meta.crossings.forEach((c, i) => expect(flowDist(m, routeFlow(m, east, i), from), c.id).toBeLessThan(Infinity));
  });
});

describe('a match on the baked map', () => {
  it('keeps every Soldier on walkable ground inside the Play Area', () => {
    const m: Match = match();
    for (let t = 0; t < 20 * 240; t++) {
      step(m, []);
      if (t % 10) continue;
      for (const side of SIDES)
        for (const s of commanderView(m, side).friendlies) {
          expect(insidePolygon(m.map.playArea, s.x, s.y), `Soldier ${s.id} at tick ${t}`).toBe(true);
          expect(walkCost(m, s.x, s.y), `Soldier ${s.id} at tick ${t}`).toBeGreaterThan(0);
        }
    }
  });
});
