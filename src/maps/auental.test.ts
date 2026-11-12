import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enemy, inside, near, readBake, rotated } from './bake-check';

// Checks the committed Auental bake against the #150 layout. MAP_DIR points it at a preview bake instead (assets/maps/auental/work/).
const { dir, map, n, cover, ids, floats, cell, point, twinOf, riverCrossings, coverShare } = readBake('auental');

describe('Auental map metadata', () => {
  it('is a 2.5 km map with working names', () => {
    expect(map).toMatchObject({ name: 'Auental', river: 'Auer', sizeM: 2500 });
  });

  it('has a closed Play Area of 6.05 km² inside the bake, its corners cut north-west and south-east', () => {
    let area = 0;
    map.playArea.forEach((a, i) => {
      const b = map.playArea[(i + 1) % map.playArea.length]!;
      area += a.x * b.y - b.x * a.y;
    });
    expect(Math.abs(area / 2) / 1e6).toBeCloseTo(6.05, 2);
    expect(near(map.playArea[0]!, map.playArea.at(-1)!)).toBe(false);
    for (const p of map.playArea) expect(Math.max(Math.abs(p.x), Math.abs(p.y))).toBeLessThanOrEqual(1250);
    expect(inside({ x: -1200, y: 1200 }, map.playArea)).toBe(false);
    expect(inside({ x: 1200, y: -1200 }, map.playArea)).toBe(false);
  });

  it('has NATO HQ west and Warsaw Pact HQ east with 60 m zones inside the Play Area', () => {
    expect(map.hqs.nato).toMatchObject({ x: -1120, y: -40, radius: 60 });
    expect(map.hqs.pact).toMatchObject({ x: 1120, y: 40, radius: 60 });
    for (const hq of [map.hqs.nato, map.hqs.pact])
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        expect(inside({ x: hq.x + dx! * hq.radius, y: hq.y + dy! * hq.radius }, map.playArea)).toBe(true);
  });

  it('has the 12 points of the layout table: letters, positions, radii and owners at the start', () => {
    expect(map.points.map((p) => [p.id, p.x, p.y, p.radius, p.owner])).toEqual([
      ['A', -900, 480, 30, 'nato'],
      ['B', -840, -640, 30, 'nato'],
      ['C', -520, 560, 35, null],
      ['D', -430, -520, 35, null],
      ['E', -130, 40, 45, null],
      ['F', -120, -1000, 35, null],
      ['G', 120, 1000, 35, null],
      ['H', 130, -40, 45, null],
      ['I', 430, 520, 35, null],
      ['J', 520, -560, 35, null],
      ['K', 840, 640, 30, 'pact'],
      ['L', 900, -480, 30, 'pact'],
    ]);
    for (const p of map.points) {
      expect(p.name, 'the radio speaks a point by its letter').toBe(p.id);
      expect(inside(p, map.playArea), p.id).toBe(true);
    }
    expect(map.keystone).toEqual(['E', 'H']);
  });

  it('has a 10 x 10 grid of 250 m squares, A-J west to east', () => {
    expect(map.grid).toEqual({ cols: 10, rows: 10, squareM: 250, letters: 'ABCDEFGHIJ' });
  });

  it('has 7 crossings, 3 / 1 / 3 north to south: the main bridge and three twin pairs, armour at 5', () => {
    const kinds = (sign: number) => map.crossings.filter((c) => Math.sign(c.y) === sign).map((c) => c.kind).sort();
    expect(map.crossings).toHaveLength(7);
    expect(map.crossings.filter((c) => c.y === 0)).toMatchObject([{ kind: 'bridge', x: 0 }]);
    expect(kinds(1)).toEqual(['bridge', 'footbridge', 'ford']);
    expect(kinds(-1)).toEqual(['bridge', 'footbridge', 'ford']);
    expect(map.crossings.filter((c) => c.kind !== 'footbridge')).toHaveLength(5);
  });

  it('lists a play-area mip chain from 8192 down to 1 px and the surroundings out to 7.5 km, all present', () => {
    expect(map.images.play).toEqual([...Array(14).keys()].map((k) => `map_${8192 >> k}.webp`));
    expect(map.images.outer.sizeM).toBe(7500);
    for (const f of [...map.images.play, map.images.outer.file]) expect(existsSync(new URL(f, dir)), f).toBe(true);
  });

  it('places points, HQs, crossings and the boundary to match under a half turn', () => {
    for (const p of map.playArea) expect(map.playArea.some((q) => near(q, rotated(p)))).toBe(true);
    expect(near(map.hqs.pact, rotated(map.hqs.nato))).toBe(true);
    const twins = map.points.map((p) => p.id + twinOf(p).id);
    expect(twins).toEqual(['AL', 'BK', 'CJ', 'DI', 'EH', 'FG', 'GF', 'HE', 'ID', 'JC', 'KB', 'LA']);
    for (const p of map.points) {
      expect(twinOf(p).owner).toBe(p.owner ? enemy(p.owner) : null);
      expect(twinOf(p).radius).toBe(p.radius);
    }
    for (const c of map.crossings)
      expect(map.crossings.some((d) => d.kind === c.kind && d.halfWidth === c.halfWidth && near(d, rotated(c)))).toBe(true);
  });
});

describe('Auental data grids', () => {
  const hn = map.sizeM / map.data.heightCellM!;
  const ground = floats(map.data.ground);
  const top = floats(map.data.top);

  it('covers the 2.5 km map with a 1 m cover grid and 2 m height grids', () => {
    expect(n * map.data.cellM).toBe(2500);
    expect(cover.length).toBe(n * n);
    expect(map.data.heightCellM).toBe(2);
    expect(ground.length).toBe(hn * hn);
    expect(top.length).toBe(hn * hn);
  });

  it('has no gaps: every cell has a known cover id and sane heights', () => {
    const known = new Set(Object.values(ids));
    let bad = 0;
    for (let k = 0; k < n * n; k++) if (!known.has(cover[k]!)) bad++;
    for (let k = 0; k < hn * hn; k++) {
      const g = ground[k]!, t = top[k]!;
      if (!Number.isFinite(g) || !Number.isFinite(t) || g < -5 || t > 120 || t < g - 0.1) bad++;
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

  it('puts Hochwacht (G) on the highest ground, about 60 m above the river', () => {
    const at = (x: number, y: number) => ground[Math.floor((1250 - y) / 2) * hn + Math.floor((x + 1250) / 2)]!;
    let max = -Infinity;
    for (let j = 0; j < hn; j++)
      for (let i = 0; i < hn; i++) {
        const x = i * 2 - 1249, y = 1249 - j * 2;
        if (inside({ x, y }, map.playArea) && Math.hypot(x - 120, y - 1000) > 150) max = Math.max(max, at(x, y));
      }
    const g = point('G');
    expect(at(g.x, g.y)).toBeGreaterThan(max);
    expect(at(g.x, g.y)).toBeGreaterThan(55);
  });

  /** Floods the cover grid from (x, y) over everything but water; with `closed`, every crossing is shut too. */
  const reach = (from: { x: number; y: number }, closed: boolean) => {
    const seen = new Uint8Array(n * n);
    for (let k = 0; k < n * n; k++) if (cover[k] === ids.water) seen[k] = 1;
    if (closed)
      for (const c of map.crossings)
        for (let dy = -25; dy <= 25; dy++) for (let dx = -25; dx <= 25; dx++) if (dx * dx + dy * dy <= 625) seen[cell(c.x + dx, c.y + dy)] = 1;
    const queue = new Int32Array(n * n);
    let head = 0, tail = 0;
    queue[tail++] = cell(from.x, from.y);
    seen[queue[0]!] = 2;
    while (head < tail) {
      const k = queue[head++]!, i = k % n;
      for (const j of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n])
        if (j >= 0 && j < n * n && !seen[j]) {
          seen[j] = 2;
          queue[tail++] = j;
        }
    }
    return (p: { x: number; y: number }) => seen[cell(p.x, p.y)] === 2;
  };

  it('leaves no way round the river: north to the edge, south into the reservoir, which fills the south edge', () => {
    const open = reach(map.hqs.nato, false);
    expect(open(map.hqs.pact), 'over the crossings').toBe(true);
    const shut = reach(map.hqs.nato, true);
    expect(shut(map.hqs.pact), 'every crossing shut').toBe(false);
    expect(map.points.filter(shut).map((p) => p.id), "NATO's bank").toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('balances each point against its twin: HQ distances, river crossings on the way, cover', () => {
    for (const p of map.points) {
      const twin = twinOf(p);
      for (const side of ['nato', 'pact'] as const) {
        const hq = map.hqs[side], twinHq = map.hqs[enemy(side)];
        expect(Math.hypot(p.x - hq.x, p.y - hq.y)).toBeCloseTo(Math.hypot(twin.x - twinHq.x, twin.y - twinHq.y), 0);
        expect(riverCrossings(hq, p), `${p.id} from ${side}`).toBe(riverCrossings(twinHq, twin));
      }
      expect(Math.abs(coverShare(p, 40) - coverShare(twin, 40)), `${p.id} vs ${twin.id}`).toBeLessThan(0.12);
    }
    // a straight walk from NATO HQ stays on its bank to A-F and wades the river once to G-L
    expect(map.points.map((p) => riverCrossings(map.hqs.nato, p))).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  });
});
