/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gridRef as ref } from '../sim/grid-ref';
import type { SideId, Vec2 } from '../sim/types';
import type { BakedMap } from './baked';

// Checks the committed Kaltenbach bake against the slice layout (#25 as revised 2026-11-04, #30).
// MAP_DIR points it at a preview bake instead (assets/maps/kaltenbach/work/).
const DIR = process.env.MAP_DIR
  ? pathToFileURL(process.env.MAP_DIR.replace(/\/?$/, '/'))
  : new URL('../../public/maps/kaltenbach/', import.meta.url);
const map: BakedMap = JSON.parse(readFileSync(new URL('map.json', DIR), 'utf8'));

const gridRef = (x: number, y: number) => ref(map.grid, { x, y });

/** Ray-casting point-in-polygon. */
function inside(p: Vec2, poly: Vec2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

const rotated = (p: Vec2) => ({ x: -p.x, y: -p.y });
const near = (a: Vec2, b: Vec2, tol = 0.5) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const point = (id: string) => map.points.find((p) => p.id === id)!;
const twinOf = (p: Vec2) => map.points.find((q) => near(q, rotated(p)))!;
const enemy = (s: SideId): SideId => (s === 'nato' ? 'pact' : 'nato');

describe('Kaltenbach map metadata', () => {
  it('is a 960 m map with working names', () => {
    expect(map.sizeM).toBe(960);
    expect(map.name).toBe('Kaltenbach');
    expect(map.village).toBe('Kaltenbach');
    expect(map.river).toBeTruthy();
  });

  it('has a closed, irregular Play Area boundary about 850 m across', () => {
    expect(map.playArea.length).toBeGreaterThan(8);
    for (const p of map.playArea) expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeLessThanOrEqual(480);
    let area = 0;
    map.playArea.forEach((a, i) => {
      const b = map.playArea[(i + 1) % map.playArea.length]!;
      area += a.x * b.y - b.x * a.y;
    });
    expect(Math.abs(area / 2)).toBeGreaterThan(850 * 850 * 0.8);
    expect(near(map.playArea[0]!, map.playArea.at(-1)!)).toBe(false);
    const xs = map.playArea.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(820);
  });

  it('has NATO HQ west and Warsaw Pact HQ east at x = ±415, ~70 m zones inside the Play Area', () => {
    expect(map.hqs.nato).toMatchObject({ x: -415, y: 0, radius: 35 });
    expect(map.hqs.pact).toMatchObject({ x: 415, y: 0, radius: 35 });
    for (const hq of [map.hqs.nato, map.hqs.pact])
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        expect(inside({ x: hq.x + dx! * hq.radius, y: hq.y + dy! * hq.radius }, map.playArea)).toBe(true);
  });

  it('has 5 Capture Points, 1-3-1: A and E owned on the hills, B, C, D neutral on the spine with C in G7', () => {
    expect(map.points.map((p) => [p.id, gridRef(p.x, p.y), p.owner])).toEqual([
      ['A', 'C11', 'nato'],
      ['B', 'G3', null],
      ['C', 'G7', null],
      ['D', 'G11', null],
      ['E', 'K3', 'pact'],
    ]);
    for (const p of map.points) {
      expect(p.radius).toBe(25);
      expect(inside(p, map.playArea)).toBe(true);
    }
    for (const id of ['B', 'C', 'D']) expect(point(id).x).toBe(0);
  });

  it('has a 13 x 13 grid of ~74 m squares, A-M west to east', () => {
    expect(map.grid).toMatchObject({ cols: 13, rows: 13, letters: 'ABCDEFGHIJKLM' });
    expect(map.grid.squareM * 13).toBeCloseTo(960);
    expect(gridRef(-479, 479)).toBe('A1');
    expect(gridRef(479, -479)).toBe('M13');
  });

  it('has 5 crossings: a centre bridge, fords at y = ±345 and footbridges at y = ±210', () => {
    const kinds = (sign: number) =>
      map.crossings.filter((c) => Math.sign(Math.round(c.y)) === sign).map((c) => c.kind).sort();
    expect(map.crossings).toHaveLength(5);
    expect(kinds(0)).toEqual(['bridge']);
    expect(kinds(1)).toEqual(['footbridge', 'ford']);
    expect(kinds(-1)).toEqual(['footbridge', 'ford']);
    const ys = (kind: string) => map.crossings.filter((c) => c.kind === kind).map((c) => Math.abs(c.y));
    expect(ys('ford')).toEqual([345, 345]);
    expect(ys('footbridge')).toEqual([210, 210]);
  });

  it('lists a play-area mip chain from 8192 down to 1 px and the surroundings out to 2.88 km, all present', () => {
    expect(map.images.play[0]).toMatch(/8192/);
    expect(map.images.play).toContain('map_4096.webp');
    expect(map.images.play).toHaveLength(14);
    expect(map.images.outer.sizeM).toBe(2880);
    for (const f of [...map.images.play, map.images.outer.file]) expect(existsSync(new URL(f, DIR)), f).toBe(true);
  });

  it('places points, HQs, crossings and the boundary to match under a 180° rotation', () => {
    for (const p of map.playArea) expect(map.playArea.some((q) => near(q, rotated(p)))).toBe(true);
    expect(near(map.hqs.pact, rotated(map.hqs.nato))).toBe(true);
    for (const p of map.points) {
      const twin = twinOf(p);
      expect(twin, p.id).toBeTruthy();
      expect(twin.owner).toBe(p.owner ? enemy(p.owner) : null);
    }
    expect(twinOf(point('A')).id).toBe('E');
    expect(twinOf(point('B')).id).toBe('D');
    for (const c of map.crossings)
      expect(map.crossings.some((d) => d.kind === c.kind && near(d, rotated(c)))).toBe(true);
  });
});

describe('Kaltenbach data grids', () => {
  const n = map.data.cells;
  const bytes = (f: string) => readFileSync(new URL(f, DIR));
  const floats = (f: string) => {
    const b = bytes(f);
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  };
  const cover = bytes(map.data.cover);
  const ground = floats(map.data.ground);
  const top = floats(map.data.top);
  const ids = map.data.coverIds;
  /** Cell holding world point (x, y): row 0 north, column 0 west. */
  const cell = (x: number, y: number) =>
    Math.floor((map.sizeM / 2 - y) / map.data.cellM) * n + Math.floor((x + map.sizeM / 2) / map.data.cellM);
  const isRiver = (k: number) => cover[k] === ids.water || cover[k] === ids.ford;

  /** Mean ground height on a ring of radius r around p. */
  const ringGround = (p: Vec2, r: number) => {
    let s = 0;
    for (let k = 0; k < 64; k++) s += ground[cell(p.x + r * Math.cos((2 * Math.PI * k) / 64), p.y + r * Math.sin((2 * Math.PI * k) / 64))]!;
    return s / 64;
  };

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

  it('covers the 960 m map at 1 m with a cover id and two heights per cell', () => {
    expect(n * map.data.cellM).toBe(960);
    expect(cover.length).toBe(n * n);
    expect(ground.length).toBe(n * n);
    expect(top.length).toBe(n * n);
  });

  it('has no gaps: every cell has a known cover id and sane heights', () => {
    const known = new Set(Object.values(ids));
    let bad = 0;
    for (let k = 0; k < n * n; k++) {
      const g = ground[k]!, t = top[k]!;
      if (!known.has(cover[k]!) || !Number.isFinite(g) || !Number.isFinite(t) || g < -5 || t > 90 || t < g - 0.1) bad++;
    }
    expect(bad).toBe(0);
  });

  it('shows the crossings in the cover grid: fords as ford, bridges as road, the river as water beside them', () => {
    for (const c of map.crossings) {
      expect(cover[cell(c.x, c.y)], c.id).toBe(c.kind === 'ford' ? ids.ford : ids.road);
      for (const dy of [-25, 25]) {
        let water = false;
        for (let dx = -25; dx <= 25; dx++) water ||= cover[cell(c.x + dx, c.y + dy)] === ids.water;
        expect(water, `${c.id} ${dy}`).toBe(true);
      }
    }
  });

  it('puts A and E on hills above the valley', () => {
    for (const id of ['A', 'E']) {
      const p = point(id);
      expect(ground[cell(p.x, p.y)]! - ringGround(p, 110), id).toBeGreaterThan(4);
      expect(ground[cell(p.x, p.y)]! - ground[cell(0, 0)]!, id).toBeGreaterThan(12);
    }
  });

  it('balances each point against its rotated twin: HQ distances, river crossings on the way, cover', () => {
    for (const p of map.points) {
      const twin = twinOf(p);
      for (const side of ['nato', 'pact'] as const) {
        const hq = map.hqs[side], twinHq = map.hqs[enemy(side)];
        expect(Math.hypot(p.x - hq.x, p.y - hq.y)).toBeCloseTo(Math.hypot(twin.x - twinHq.x, twin.y - twinHq.y), 0);
        expect(riverCrossings(hq, p), `${p.id} from ${side}`).toBe(riverCrossings(twinHq, twin));
      }
      expect(Math.abs(coverShare(p, 40) - coverShare(twin, 40)), `${p.id} vs ${twin.id}`).toBeLessThan(0.12);
    }
    // the river puts B on NATO's bank and D on the Warsaw Pact's: the attacker crosses once, the defender never
    expect([riverCrossings(map.hqs.nato, point('B')), riverCrossings(map.hqs.pact, point('B'))]).toEqual([0, 1]);
    expect([riverCrossings(map.hqs.nato, point('C')), riverCrossings(map.hqs.pact, point('C'))]).toEqual([0, 0]);
  });
});
