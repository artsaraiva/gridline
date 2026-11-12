// Map loader: a bake's map.json and 1 m cover grid become the Simulation's MapData, with the terrain resampled to its cells.
import { COVER, WALL, WATER } from '../sim/grid';
import type { Terrain } from '../sim/types';
import type { BakedMap } from './baked';

/**
 * A crossing owns the deck and ford cells within this of its centre (a footbridge runs diagonally over Kaltenbach's 12 m river).
 * #150: on Auental's 20 m Auer every deck and ford cell over the water lies within 12 m of its crossing, so one reach fits both.
 */
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
    drive: new Uint8Array(cols * cols), clear: new Uint8Array(cols * cols).fill(255),
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
      // #107: a vehicle is stopped by any wall or building in the cell, and half a cell of hedge, woods or water (props are no
      // obstacle: no collisions)
      const built = (c[id.wall!] ?? 0) + (c[id.building!] ?? 0);
      const stop = (c[id.hedge!] ?? 0) + (c[id.woods!] ?? 0) + water;
      t.drive[k] = built > 0 || stop >= half ? 0 : t.wade[k] ? 30 : (c[id.road!] ?? 0) > 0 ? 10 : 20; // a cell the road runs through, however thin the track
    }
  // #107: how close the nearest solid or wet 1 m cell comes to each cell's centre, for the vehicles' hull margin
  const stop = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) stop[k] = [id.hedge, id.woods, id.wall, id.building, id.water].includes(cover[k]) ? 1 : 0;
  const R = 5;
  for (let j = 0; j < cols; j++)
    for (let i = 0; i < cols; i++) {
      const cx = (i + 0.5) * cellM; // metres from the south-west corner
      const cy = (j + 0.5) * cellM;
      let best = R * R;
      for (let b = Math.max(0, Math.floor(cy - R)); b < Math.min(n, Math.ceil(cy + R)); b++)
        for (let a = Math.max(0, Math.floor(cx - R)); a < Math.min(n, Math.ceil(cx + R)); a++) {
          const d2 = (a + 0.5 - cx) ** 2 + (b + 0.5 - cy) ** 2;
          if (d2 < best && stop[(n - 1 - b) * n + a]) best = d2;
        }
      if (best < R * R) t.clear[j * cols + i] = Math.round(Math.sqrt(best) * 10);
    }
  map.crossings.forEach((x, q) => {
    for (let j = Math.max(0, Math.floor((x.y - CROSSING_R - t.y0) / cellM)); j <= Math.min(cols - 1, Math.floor((x.y + CROSSING_R - t.y0) / cellM)); j++)
      for (let i = Math.max(0, Math.floor((x.x - CROSSING_R - t.x0) / cellM)); i <= Math.min(cols - 1, Math.floor((x.x + CROSSING_R - t.x0) / cellM)); i++) {
        const dx = t.x0 + (i + 0.5) * cellM - x.x;
        const dy = t.y0 + (j + 0.5) * cellM - x.y;
        const k = j * cols + i;
        if (!deck[k] || dx * dx + dy * dy > CROSSING_R * CROSSING_R) continue;
        t.crossing[k] = q;
        if (x.kind === 'footbridge') t.drive[k] = 0; // #107: the road bridge and the fords are the vehicle crossings
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
