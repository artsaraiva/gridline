import { describe, expect, it } from 'vitest';
import { dock, leader } from './dock';

describe('docking the map tags: overlapping tags drop into a stack', () => {
  const tag = (x: number, y: number, w = 120, h = 20) => ({ x, y, w, h });

  it('leaves tags that are clear of each other where they ask to be', () => {
    const tags = [tag(100, 100), tag(100, 200), tag(400, 100)];
    expect(dock(tags)).toEqual([{ x: 100, y: 100 }, { x: 100, y: 200 }, { x: 400, y: 100 }]);
  });

  it('drops the lower of two overlapping tags under the other, a gap apart, whatever order they come in', () => {
    expect(dock([tag(100, 110), tag(140, 100)])).toEqual([{ x: 100, y: 124 }, { x: 140, y: 100 }]);
  });

  it('stacks a whole cluster with no two tags touching', () => {
    const tags = [tag(100, 100), tag(110, 104), tag(120, 108), tag(130, 112), tag(90, 116)];
    const out = dock(tags);
    const ys = out.map((o) => o.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(24);
    expect(out.map((o) => o.x)).toEqual(tags.map((t) => t.x));
  });

  it('keeps a tag clear of a blocked box (the map Confirm button)', () => {
    expect(dock([tag(100, 100)], [{ x: 80, y: 90, w: 200, h: 40 }])).toEqual([{ x: 100, y: 134 }]);
  });

  it('draws the leader out at 45 degrees, then level into the middle of the tag, starting clear of the mark', () => {
    expect(leader(100, 200, tag(200, 140))).toBe('M105.7 194.3L150 150H200');
    expect(leader(100, 150, tag(200, 140))).toBe('M108 150H200'); // level already: straight along
  });
});
