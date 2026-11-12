/// <reference types="node" />
// What the map data tests (kaltenbach.test.ts, auental.test.ts) read from a bake and measure on it.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { SideId, Vec2 } from '../sim/types';
import type { BakedMap } from './baked';

/** Ray-casting point-in-polygon. */
export function inside(p: Vec2, poly: Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

export const rotated = (p: Vec2) => ({ x: -p.x, y: -p.y });
export const near = (a: Vec2, b: Vec2, tol = 0.5) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
export const enemy = (s: SideId): SideId => (s === 'nato' ? 'pact' : 'nato');

/** The committed bake in public/maps/<id>/, or the preview bake MAP_DIR points at (assets/maps/<id>/work/). */
export function readBake(id: string) {
  const dir = process.env.MAP_DIR
    ? pathToFileURL(process.env.MAP_DIR.replace(/\/?$/, '/'))
    : new URL(`../../public/maps/${id}/`, import.meta.url);
  const map: BakedMap = JSON.parse(readFileSync(new URL('map.json', dir), 'utf8'));
  const bytes = (f: string) => readFileSync(new URL(f, dir));
  const floats = (f: string) => {
    const b = bytes(f);
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  };
  const n = map.data.cells;
  const cover = bytes(map.data.cover);
  const ids = map.data.coverIds;
  /** Cell of the cover grid holding world point (x, y): row 0 north, column 0 west. */
  const cell = (x: number, y: number) =>
    Math.floor((map.sizeM / 2 - y) / map.data.cellM) * n + Math.floor((x + map.sizeM / 2) / map.data.cellM);
  const isRiver = (k: number) => cover[k] === ids.water || cover[k] === ids.ford;
  const point = (id: string) => map.points.find((p) => p.id === id)!;
  const twinOf = (p: Vec2) => map.points.find((q) => near(q, rotated(p)))!;

  /** Times a straight walk from the HQ to the edge of the point's zone wades into the river. */
  const riverCrossings = (from: Vec2, p: Vec2 & { radius: number }) => {
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    let count = 0, last = -Infinity;
    for (let s = 0; s <= d - p.radius; s += 0.5) {
      const k = cell(from.x + ((p.x - from.x) * s) / d, from.y + ((p.y - from.y) * s) / d);
      if (isRiver(k)) {
        if (s - last > 30) count++;
        last = s;
      }
    }
    return count;
  };

  /** Share of cells within r of p that give cover (hedge, woods, building, wall, prop). */
  const coverShare = (p: Vec2, r: number) => {
    const solid = new Set([ids.hedge, ids.woods, ids.building, ids.wall, ids.prop]);
    let all = 0, hit = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        all++;
        if (solid.has(cover[cell(p.x + dx, p.y + dy)]!)) hit++;
      }
    return hit / all;
  };

  return { dir, map, n, cover, ids, floats, cell, point, twinOf, riverCrossings, coverShare };
}
