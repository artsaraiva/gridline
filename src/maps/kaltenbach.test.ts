/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../sim/types';
import type { BakedMap } from './baked';

// Checks the committed Kaltenbach bake against the slice layout (#25, fords per #26).
const DIR = new URL('../../public/maps/kaltenbach/', import.meta.url);
const map: BakedMap = JSON.parse(readFileSync(new URL('map.json', DIR), 'utf8'));

function gridRef(x: number, y: number): string {
  const half = map.sizeM / 2;
  const col = Math.floor((x + half) / map.grid.squareM);
  const row = Math.floor((half - y) / map.grid.squareM);
  return `${map.grid.letters[col]}${row + 1}`;
}

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
const near = (a: Vec2, b: Vec2, tol = 0.5) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= tol;

describe('Kaltenbach map metadata', () => {
  it('is a 640 m map with working names', () => {
    expect(map.sizeM).toBe(640);
    expect(map.name).toBe('Kaltenbach');
    expect(map.village).toBe('Kaltenbach');
    expect(map.river).toBeTruthy();
  });

  it('has a closed Play Area boundary inside the map', () => {
    expect(map.playArea.length).toBeGreaterThanOrEqual(3);
    for (const p of map.playArea) expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeLessThanOrEqual(320);
    // closed: non-zero area and no repeated closing vertex
    let area = 0;
    map.playArea.forEach((a, i) => {
      const b = map.playArea[(i + 1) % map.playArea.length]!;
      area += a.x * b.y - b.x * a.y;
    });
    expect(Math.abs(area / 2)).toBeGreaterThan(550 * 550 * 0.8);
    expect(near(map.playArea[0]!, map.playArea.at(-1)!)).toBe(false);
  });

  it('has NATO HQ in the west and Warsaw Pact HQ in the east, ~50 m zones inside the Play Area', () => {
    expect(map.hqs.nato.x).toBeLessThan(-250);
    expect(map.hqs.pact.x).toBeGreaterThan(250);
    for (const hq of [map.hqs.nato, map.hqs.pact]) {
      expect(hq.radius).toBe(25);
      expect(inside(hq, map.playArea)).toBe(true);
    }
  });

  it('has 3 Capture Points at E2, E5 and E8 with a 25 m radius', () => {
    expect(map.points.map((p) => gridRef(p.x, p.y))).toEqual(['E2', 'E5', 'E8']);
    for (const p of map.points) {
      expect(p.radius).toBe(25);
      expect(inside(p, map.playArea)).toBe(true);
    }
  });

  it('has a 9 x 9 grid of ~71 m squares, A-I west to east', () => {
    expect(map.grid).toMatchObject({ cols: 9, rows: 9, letters: 'ABCDEFGHI' });
    expect(map.grid.squareM * 9).toBeCloseTo(640);
    expect(gridRef(-319, 319)).toBe('A1');
    expect(gridRef(319, -319)).toBe('I9');
  });

  it('has 5 crossings: a centre bridge, and north and south of it a ford at y = ±230 and a footbridge', () => {
    const kinds = (sign: number) =>
      map.crossings.filter((c) => Math.sign(Math.round(c.y)) === sign).map((c) => c.kind).sort();
    expect(map.crossings).toHaveLength(5);
    expect(kinds(0)).toEqual(['bridge']);
    expect(kinds(1)).toEqual(['footbridge', 'ford']);
    expect(kinds(-1)).toEqual(['footbridge', 'ford']);
    const fords = map.crossings.filter((c) => c.kind === 'ford').map((c) => Math.abs(c.y));
    expect(fords).toEqual([230, 230]);
  });

  it('lists a play-area mip chain from 8192 down to 1 px and the surroundings, all present', () => {
    expect(map.images.play[0]).toMatch(/8192/);
    expect(map.images.play).toContain('map_4096.webp');
    expect(map.images.play).toHaveLength(14);
    expect(map.images.outer.sizeM).toBe(1920);
    for (const f of [...map.images.play, map.images.outer.file]) expect(existsSync(new URL(f, DIR)), f).toBe(true);
  });

  it('matches itself under a 180° rotation (balanced, not mirrored)', () => {
    for (const p of map.playArea) expect(map.playArea.some((q) => near(q, rotated(p)))).toBe(true);
    expect(near(map.hqs.pact, rotated(map.hqs.nato))).toBe(true);
    for (const p of map.points) expect(map.points.some((q) => near(q, rotated(p)))).toBe(true);
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
  /** Cell holding world point (x, y): row 0 north, column 0 west. */
  const cell = (x: number, y: number) =>
    Math.floor((map.sizeM / 2 - y) / map.data.cellM) * n + Math.floor((x + map.sizeM / 2) / map.data.cellM);

  it('covers the 640 m map at 1 m with a cover id and two heights per cell', () => {
    expect(n * map.data.cellM).toBe(640);
    expect(cover.length).toBe(n * n);
    expect(ground.length).toBe(n * n);
    expect(top.length).toBe(n * n);
  });

  it('has no gaps: every cell has a known cover id and sane heights', () => {
    const ids = new Set(Object.values(map.data.coverIds));
    let bad = 0;
    for (let k = 0; k < n * n; k++) {
      const g = ground[k]!, t = top[k]!;
      if (!ids.has(cover[k]!) || !Number.isFinite(g) || !Number.isFinite(t) || g < -5 || t > 80 || t < g - 0.1) bad++;
    }
    expect(bad).toBe(0);
  });

  it('shows the crossings in the cover grid: fords as ford, bridges as road, the river as water beside them', () => {
    const { ford, road, water } = map.data.coverIds;
    for (const c of map.crossings) {
      expect(cover[cell(c.x, c.y)], c.id).toBe(c.kind === 'ford' ? ford : road);
      if (c.kind !== 'bridge') expect(cover[cell(c.x, c.y + (c.y > 0 ? 25 : -25))], c.id).toBe(water);
    }
  });

  it('has relief that matches under a 180° rotation', () => {
    const diffs: number[] = [];
    for (let k = 0; k < n * n; k++) diffs.push(Math.abs(ground[k]! - ground[n * n - 1 - k]!));
    diffs.sort((a, b) => a - b);
    expect(diffs[Math.floor(diffs.length * 0.99)]).toBeLessThan(0.25);
  });
});
