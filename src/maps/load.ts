// Map loader: a bake's map.json and 1 m cover grid become the Simulation's MapData, with the terrain resampled to its cells.
import { COVER, WALL, WATER } from '../sim/grid';
import type { Terrain } from '../sim/types';
import type { BakedMap } from './baked';

/** A crossing owns the deck and ford cells within this of its centre (a footbridge runs diagonally over a ~14 m river). */
const CROSSING_R = 16;

/**
 * `cover` is the bake's 1 m cover grid (row 0 north). Each `cellM` cell takes the majority of its 1 m cells, with two
 * rules that keep the map playable: half a cell of building is a wall, and a cell is water only when most of it is, so a
 * 3 m footbridge or a ford stays walkable as a chain of cells. Hedges, woods, walls and props are cover.
 */
export function terrainOf(map: BakedMap, cover: Uint8Array, cellM: number): Terrain {
  const { cells: n, cellM: m1, coverIds: id } = map.data;
  const f = Math.round(cellM / m1);
  const cols = Math.round(map.sizeM / cellM);
  const half = (f * f) / 2;
  const t: Terrain = {
    x0: -map.sizeM / 2, y0: -map.sizeM / 2, cols, rows: cols, cellM,
    cells: new Uint8Array(cols * cols), wade: new Uint8Array(cols * cols), crossing: new Int8Array(cols * cols).fill(-1),
  };
  const deck = new Uint8Array(cols * cols);
  for (let j = 0; j < cols; j++)
    for (let i = 0; i < cols; i++) {
      const c: Record<number, number> = {};
      for (let b = 0; b < f; b++)
        for (let a = 0; a < f; a++) {
          const v = cover[(n - 1 - (j * f + b)) * n + i * f + a]!; // 1 m row 0 is north, terrain row 0 is south
          c[v] = (c[v] ?? 0) + 1;
        }
      const k = j * cols + i;
      const solid = (c[id.hedge!] ?? 0) + (c[id.woods!] ?? 0) + (c[id.wall!] ?? 0) + (c[id.prop!] ?? 0);
      const water = c[id.water!] ?? 0;
      t.cells[k] = (c[id.building!] ?? 0) >= half ? WALL : water > half ? WATER : solid >= half ? COVER : 0;
      if (t.cells[k] === WALL || t.cells[k] === WATER) continue;
      t.wade[k] = (c[id.ford!] ?? 0) > 0 ? 1 : 0;
      deck[k] = t.wade[k]! || (c[id.road!] ?? 0) > 0 ? 1 : 0;
    }
  map.crossings.forEach((x, q) => {
    for (let j = Math.max(0, Math.floor((x.y - CROSSING_R - t.y0) / cellM)); j <= Math.min(cols - 1, Math.floor((x.y + CROSSING_R - t.y0) / cellM)); j++)
      for (let i = Math.max(0, Math.floor((x.x - CROSSING_R - t.x0) / cellM)); i <= Math.min(cols - 1, Math.floor((x.x + CROSSING_R - t.x0) / cellM)); i++) {
        const dx = t.x0 + (i + 0.5) * cellM - x.x;
        const dy = t.y0 + (j + 0.5) * cellM - x.y;
        const k = j * cols + i;
        if (deck[k] && dx * dx + dy * dy <= CROSSING_R * CROSSING_R) t.crossing[k] = q;
      }
  });
  return t;
}

/** Fetches a baked map from `dir` (e.g. `/maps/kaltenbach`) and builds its MapData; `cellM` is the Simulation's cell size. */
export async function loadBakedMap(dir: string, cellM: number): Promise<BakedMap> {
  const map: BakedMap = await (await fetch(`${dir}/map.json`)).json();
  const cover = new Uint8Array(await (await fetch(`${dir}/${map.data.cover}`)).arrayBuffer());
  return { ...map, terrain: terrainOf(map, cover, cellM) };
}
