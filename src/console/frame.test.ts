import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../sim/types';
import { frameView, under } from './frame';
import { PAD_SIZE } from './pad';

// fitView's boxes (chrome/rail.ts LAYOUT, which this DOM-free test can't load): the screen left free between the 98 px on the
// left (inset, the 40 px column, gap, grid numbers) and the Squad tiles, under the 92 px score strip, over the cursor readout.
const free = (w: number, h: number) => ({ left: 16 + 40 + 16 + 26, top: 92, right: w - 16 - 56 - 16, bottom: h - 44 });
const PAD = { left: 16, top: 16, right: 16 + PAD_SIZE.w, bottom: 16 + PAD_SIZE.h };
const outline = (id: string): Vec2[] => JSON.parse(readFileSync(new URL(`../../public/maps/${id}/map.json`, import.meta.url), 'utf8')).playArea;
const MAPS = { kaltenbach: outline('kaltenbach'), auental: outline('auental') };

/** fitView before #181: the Play Area's box fitted into the free screen, centred. */
function today(poly: Vec2[], w: number, h: number) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const freeW = Math.max(1, w - 98 - 88);
  const freeH = Math.max(1, h - 92 - 44);
  const mpp = Math.max((Math.max(...xs) - Math.min(...xs)) / freeW, (Math.max(...ys) - Math.min(...ys)) / freeH);
  return { mpp, x: (Math.min(...xs) + Math.max(...xs)) / 2 - (98 + freeW / 2 - w / 2) * mpp, y: (Math.min(...ys) + Math.max(...ys)) / 2 + (92 + freeH / 2 - h / 2) * mpp };
}

describe('framing the Play Area clear of the Asset keypad (#181)', () => {
  const wide = [[1920, 1080], [1680, 1050], [1440, 900], [1366, 768], [1280, 800], [1280, 720]] as const;

  for (const [id, poly] of Object.entries(MAPS)) {
    it(`${id}: from 1280 × 720 up the frame is today's, and the outline already clears the pad`, () => {
      for (const [w, h] of wide) {
        const f = frameView(poly, { w, h }, free(w, h), PAD);
        const was = today(poly, w, h);
        expect(f.mpp, `${w}×${h}`).toBeCloseTo(was.mpp, 9);
        expect(f.x, `${w}×${h}`).toBeCloseTo(was.x, 6);
        expect(f.y, `${w}×${h}`).toBeCloseTo(was.y, 6);
        expect(under(poly, { w, h }, f, PAD), `${w}×${h}`).toBe(false);
      }
    });

    it(`${id}: at 1024 × 768 today's frame runs under the pad; the guard clears it, inside the free screen, by shrinking no more than it must`, () => {
      const [w, h] = [1024, 768];
      expect(under(poly, { w, h }, today(poly, w, h), PAD)).toBe(true);
      const f = frameView(poly, { w, h }, free(w, h), PAD);
      expect(under(poly, { w, h }, f, PAD)).toBe(false);
      const px = poly.map((p) => ({ x: w / 2 + (p.x - f.x) / f.mpp, y: h / 2 - (p.y - f.y) / f.mpp }));
      const box = free(w, h);
      for (const p of px) {
        expect(p.x).toBeGreaterThanOrEqual(box.left - 1e-6);
        expect(p.x).toBeLessThanOrEqual(box.right + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(box.top - 1e-6);
        expect(p.y).toBeLessThanOrEqual(box.bottom + 1e-6);
      }
      expect(f.mpp / today(poly, w, h).mpp).toBeLessThan(1.1);
      // a hair less clearance and it would run under the pad again: it is the narrowest that clears it
      const grown = { left: PAD.left - 12, top: PAD.top - 12, right: PAD.right + 12, bottom: PAD.bottom + 12 };
      expect(under(poly, { w, h }, f, grown)).toBe(true);
    });

    it(`${id}: a smaller window still clears the pad`, () => {
      for (const [w, h] of [[1024, 600], [800, 600]] as const) expect(under(poly, { w, h }, frameView(poly, { w, h }, free(w, h), PAD), PAD), `${w}×${h}`).toBe(false);
    });
  }
});
