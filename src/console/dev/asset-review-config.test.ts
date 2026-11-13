import { describe, expect, it } from 'vitest';
import { insidePolygon } from '../../sim/geometry';
import { ASSETS, CYCLE_SECONDS } from './asset-review-config';

// Kaltenbach play area (simplified bounding octagon; the real polygon is tighter).
const PLAY_AREA = [
  { x: 456, y: -12 },
  { x: 460, y: 200 },
  { x: 330, y: 432 },
  { x: -330, y: 332 },
  { x: -456, y: 12 },
  { x: -460, y: -200 },
  { x: -330, y: -432 },
  { x: 330, y: -332 },
];

describe('asset review config', () => {
  it('cycles assets on a positive interval', () => {
    expect(CYCLE_SECONDS).toBeGreaterThan(0);
  });

  it('places every Asset inside the Kaltenbach Play Area and away from the enemy HQ', () => {
    const enemyHq = { x: 415, y: 0, radius: 35 };
    for (const { asset, at } of ASSETS) {
      expect(insidePolygon(PLAY_AREA, at.x, at.y)).toBe(true);
      const d2 = (at.x - enemyHq.x) ** 2 + (at.y - enemyHq.y) ** 2;
      expect(d2).toBeGreaterThanOrEqual(enemyHq.radius * enemyHq.radius);
      expect(asset).toMatch(/^(scan|supply|barrage|gunship|smoke|creep)$/);
    }
  });
});
