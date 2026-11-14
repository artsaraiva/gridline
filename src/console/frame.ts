// Where the map is framed (`fitView`): the Play Area's box fitted, centred, into the screen the chrome leaves free. #181:
// the Asset keypad holds the top-left corner, over the free box's corner; from 1280 × 720 up the outline runs clear of it
// anyway, and on a narrower window the free box gives up a strip on its left, or at its top, until the outline clears it.
// DOM-free, so the guard is tested on both maps' outlines.
import type { Vec2 } from '../sim/types';
import type { Box } from './targeting';

/** A framing: metres per CSS px, and the world point at the centre of the screen. */
export interface Frame {
  mpp: number;
  x: number;
  y: number;
}

/** Fits `playArea`'s box into `free` (px), centred, on a `screen` of that size. */
function fit(playArea: Vec2[], screen: { w: number; h: number }, free: Box): Frame {
  const xs = playArea.map((p) => p.x);
  const ys = playArea.map((p) => p.y);
  const fw = Math.max(1, free.right - free.left);
  const fh = Math.max(1, free.bottom - free.top);
  const mpp = Math.max((Math.max(...xs) - Math.min(...xs)) / fw, (Math.max(...ys) - Math.min(...ys)) / fh);
  const fx = free.left + fw / 2;
  const fy = free.top + fh / 2;
  return { mpp, x: (Math.min(...xs) + Math.max(...xs)) / 2 - (fx - screen.w / 2) * mpp, y: (Math.min(...ys) + Math.max(...ys)) / 2 + (fy - screen.h / 2) * mpp }; // screen y runs down, world y up
}

/** Whether segment a–b (px) touches `box` (Liang–Barsky). */
function segmentHits(a: Vec2, b: Vec2, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.left], [dx, box.right - a.x], [-dy, a.y - box.top], [dy, box.bottom - a.y]] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
    if (t0 > t1) return false;
  }
  return true;
}

/** Whether `p` lies inside the polygon `poly` (even-odd). */
function inside(poly: Vec2[], p: Vec2): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Whether, framed by `f`, any of the Play Area (its outline, or inside it) lies under `box` (px). */
export function under(playArea: Vec2[], screen: { w: number; h: number }, f: Frame, box: Box): boolean {
  const px = playArea.map((p) => ({ x: screen.w / 2 + (p.x - f.x) / f.mpp, y: screen.h / 2 - (p.y - f.y) / f.mpp }));
  if (px.some((a, i) => segmentHits(a, px[(i + 1) % px.length]!, box))) return true;
  return inside(px, { x: box.left, y: box.top }); // no edge crosses the box, so it is either all inside the Play Area or all out
}

/** How far the outline stays from the keypad, in px: its dark casing reaches 3.5 px out (layers/map.ts), so a hair of map shows between. */
const CLEAR_PX = 8;

/**
 * The framing of `playArea` on a `screen` whose chrome leaves `free` (px): its box fitted, centred. #181: when the Play Area
 * then runs under `pad` (the Asset keypad, px; within CLEAR_PX of it), `free` gives up a strip on its left (the map slides
 * right, using any slack, and shrinks once there is none) or one at its top, the narrowest that clears it: whichever leaves
 * the map larger.
 */
export function frameView(playArea: Vec2[], screen: { w: number; h: number }, free: Box, pad: Box): Frame {
  const keep = { left: pad.left - CLEAR_PX, top: pad.top - CLEAR_PX, right: pad.right + CLEAR_PX, bottom: pad.bottom + CLEAR_PX };
  const base = fit(playArea, screen, free);
  if (!under(playArea, screen, base, keep)) return base;
  const shrink = (side: 'left' | 'top') => {
    const at = (d: number) => fit(playArea, screen, { ...free, [side]: free[side] + d });
    let lo = 0; // still under the pad
    let hi = side === 'left' ? free.right - free.left - 1 : free.bottom - free.top - 1; // clear, or as far as it goes
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (under(playArea, screen, at(mid), keep)) lo = mid;
      else hi = mid;
    }
    return at(hi);
  };
  const left = shrink('left');
  const top = shrink('top');
  return left.mpp <= top.mpp ? left : top;
}
