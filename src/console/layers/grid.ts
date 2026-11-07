// HUD frame and grid overlay (#44): map grid lines, top-edge grid letters on a pinned line (skipping those under a
// panel) and left-rail inner-edge grid numbers, bottom and right UTM ticks, corner lat/long, compass (grid/true/magnetic
// north), scale bar, DTG strip and cursor readout, and a screen-wide crosshair through the selected Squad's leader (#92, as
// BF4 Commander: two thin lines that stop at the leader's bracket, no intersection tags).
import type { CommanderView } from '../../sim/types';
import { pxToWorld, toScreen, toWorld } from '../renderer';
import { session } from '../session';
import { cursorReadout, dtg, edgeLine, GEO, latlon, leaderOf } from '../summary';
import { targeting, type Box } from '../targeting';
import { BRACKET } from './chevrons';
import { UNIT_PX } from './symbols';

const canvas = document.getElementById('hud') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const dtgEl = document.getElementById('dtg')!;
const curEl = document.getElementById('cur')!;

const FONT = (weight: number, px: number) => `${weight} ${px}px 'Chakra Petch', ui-monospace, monospace`;
const CHROME = (a: number) => `rgba(232, 226, 200, ${a})`;
const HOSTILE = '#ff4b3e';

let cw = 0;
let ch = 0;
let cdpr = 0;

function syncCanvas() {
  const w = innerWidth;
  const h = innerHeight;
  const dpr = devicePixelRatio || 1;
  if (w !== cw || h !== ch || dpr !== cdpr) {
    cw = w;
    ch = h;
    cdpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
}

function readRects(): Box[] {
  return [...document.querySelectorAll('[data-hit]')]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
}

/** Draws the HUD frame, grid, crosshair, compass, scale bar and bottom-centre readouts; hides them between matches. */
export function drawGrid(view: CommanderView | null, now: number) {
  syncCanvas();
  dtgEl.hidden = !view;
  curEl.hidden = !view;
  if (!view) return;

  const map = session.host?.map;
  const g = map?.grid;
  const dtgText = dtg(now);
  if (dtgEl.textContent !== dtgText) dtgEl.textContent = dtgText;
  const curText = cursorReadout(targeting.pointer, view, g, targeting.selected);
  if (curEl.textContent !== curText) curEl.textContent = curText;

  const W = cw;
  const H = ch;
  const screen = { w: W, h: H };
  const rects = readRects();

  if (g) {
    const halfW = (g.cols * g.squareM) / 2;
    const halfH = (g.rows * g.squareM) / 2;

    // 1. Faint map grid lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = CHROME(0.13);
    ctx.beginPath();
    for (let i = 0; i <= g.cols; i++) {
      const sx = toScreen({ x: -halfW + i * g.squareM, y: 0 }).x;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, H);
    }
    for (let j = 0; j <= g.rows; j++) {
      const sy = toScreen({ x: 0, y: halfH - j * g.squareM }).y;
      ctx.moveTo(0, sy);
      ctx.lineTo(W, sy);
    }
    ctx.stroke();

    // 2. Selected Squad crosshair through its leader (#92)
    const sel = view.squads.find((q) => q.id === targeting.selected);
    const lead = sel && leaderOf(view, sel);
    if (lead) {
      const { x: csx, y: csy } = toScreen(lead);
      const gap = BRACKET * UNIT_PX; // the bracket's half-size on screen
      ctx.strokeStyle = CHROME(0.75);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, csy);
      ctx.lineTo(csx - gap, csy);
      ctx.moveTo(csx + gap, csy);
      ctx.lineTo(W, csy);
      ctx.moveTo(csx, 0);
      ctx.lineTo(csx, csy - gap);
      ctx.moveTo(csx, csy + gap);
      ctx.lineTo(csx, H);
      ctx.stroke();
    }

    // 3. Top-edge grid letters and left-rail inner-edge grid numbers
    const xs: number[] = [];
    for (let i = 0; i <= g.cols; i++) {
      const sx = toScreen({ x: -halfW + i * g.squareM, y: 0 }).x;
      if (sx > 8 && sx < W - 8) xs.push(sx);
      if (i < g.cols) {
        const cx = toScreen({ x: -halfW + (i + 0.5) * g.squareM, y: 0 }).x;
        if (cx > 8 && cx < W - 8) xs.push(cx);
      }
    }
    const ys: number[] = [40]; // always sample the left rail's vertical span so numbers align with its inner edge
    for (let j = 0; j <= g.rows; j++) {
      const sy = toScreen({ x: 0, y: halfH - j * g.squareM }).y;
      if (sy > 8 && sy < H - 8) ys.push(sy);
      if (j < g.rows) {
        const cy = toScreen({ x: 0, y: halfH - (j + 0.5) * g.squareM }).y;
        if (cy > 8 && cy < H - 8) ys.push(cy);
      }
    }
    const topAt = edgeLine(rects, 'top', 0, xs, screen); // #54: pinned to the edge, so the row never jumps; covered letters are skipped
    const leftAt = edgeLine(rects, 'left', 300, ys, screen);

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = CHROME(0.9);
    ctx.strokeStyle = CHROME(0.9);
    ctx.lineWidth = 1;
    ctx.font = FONT(700, 13);
    ctx.textAlign = 'center';

    for (let i = 0; i < g.cols; i++) {
      const sx = toScreen({ x: -halfW + (i + 0.5) * g.squareM, y: 0 }).x;
      if (sx > 8 && sx < W - 8) {
        const p = topAt(sx);
        if (p !== null) ctx.fillText(g.letters[i]!, sx, p + 12);
      }
    }
    for (let j = 0; j < g.rows; j++) {
      const sy = toScreen({ x: 0, y: halfH - (j + 0.5) * g.squareM }).y;
      if (sy > 8 && sy < H - 8) {
        const p = leftAt(sy);
        if (p !== null) ctx.fillText(String(j + 1), p + 11, sy);
      }
    }
    for (let i = 0; i <= g.cols; i++) {
      const sx = toScreen({ x: -halfW + i * g.squareM, y: 0 }).x;
      if (sx > 0 && sx < W) {
        const p = topAt(sx);
        if (p !== null) {
          ctx.beginPath();
          ctx.moveTo(sx, p);
          ctx.lineTo(sx, p + 7);
          ctx.stroke();
        }
      }
    }
    for (let j = 0; j <= g.rows; j++) {
      const sy = toScreen({ x: 0, y: halfH - j * g.squareM }).y;
      if (sy > 0 && sy < H) {
        const p = leftAt(sy);
        if (p !== null) {
          ctx.beginPath();
          ctx.moveTo(p, sy);
          ctx.lineTo(p + 7, sy);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // 4. Bottom and right UTM ticks + corner lat/long + compass + scale bar
  const w0 = toWorld(0, 0);
  const w1 = toWorld(W, H);
  const mpp = pxToWorld();
  const stepM = [100, 200, 500].find((v) => v / mpp >= 70) ?? 500;

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
  ctx.font = FONT(600, 10);
  ctx.fillStyle = CHROME(0.6);
  ctx.strokeStyle = CHROME(0.6);
  ctx.lineWidth = 1;

  const utmXs: number[] = [];
  for (let E = Math.ceil((GEO.E0 + w0.x) / stepM) * stepM; E <= GEO.E0 + w1.x; E += stepM) {
    const sx = toScreen({ x: E - GEO.E0, y: 0 }).x;
    if (sx > 8 && sx < W - 8) utmXs.push(sx);
  }
  const utmYs: number[] = [40]; // align right-edge northings with the Squad tile column
  for (let N = Math.ceil((GEO.N0 + w1.y) / stepM) * stepM; N <= GEO.N0 + w0.y; N += stepM) {
    const sy = toScreen({ x: 0, y: N - GEO.N0 }).y;
    if (sy > 8 && sy < H - 160) utmYs.push(sy);
  }
  const bottomAt = edgeLine(rects, 'bottom', 140, utmXs, screen);
  const rightAt = edgeLine(rects, 'right', 140, utmYs, screen);

  for (let E = Math.ceil((GEO.E0 + w0.x) / stepM) * stepM; E <= GEO.E0 + w1.x; E += stepM) {
    const sx = toScreen({ x: E - GEO.E0, y: 0 }).x;
    if (sx < 8 || sx > W - 180) continue; // keep clear of bottom-right scale bar
    const p = bottomAt(sx);
    if (p === null) continue;
    ctx.beginPath();
    ctx.moveTo(sx, p);
    ctx.lineTo(sx, p - 5);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round((((E % 100000) + 100000) % 100000) / 100)).padStart(3, '0'), sx, p - 12);
  }
  for (let N = Math.ceil((GEO.N0 + w1.y) / stepM) * stepM; N <= GEO.N0 + w0.y; N += stepM) {
    const sy = toScreen({ x: 0, y: N - GEO.N0 }).y;
    if (sy < 8 || sy > H - 160) continue; // keep clear of bottom-right compass
    const p = rightAt(sy);
    if (p === null) continue;
    ctx.beginPath();
    ctx.moveTo(p, sy);
    ctx.lineTo(p - 5, sy);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round((((N % 100000) + 100000) % 100000) / 100)).padStart(3, '0'), p - 8, sy);
  }

  // Corner lat/long readouts
  ctx.font = FONT(600, 11);
  ctx.fillStyle = CHROME(0.6);
  ctx.textAlign = 'left';
  ctx.fillText(latlon(w0), 298, 28);
  ctx.textAlign = 'right';
  ctx.fillText(latlon(w1), W - 40, H - 18);

  // Compass (grid, true and magnetic north) and scale bar bottom-right
  const cx = W - 80;
  const cy = H - 120;
  const R = 28;
  ctx.strokeStyle = CHROME(0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  for (let a = 0; a < 360; a += 10) {
    const r0 = a % 90 === 0 ? R - 8 : a % 30 === 0 ? R - 5 : R - 3;
    const tt = ((a - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(tt) * r0, cy + Math.sin(tt) * r0);
    ctx.lineTo(cx + Math.cos(tt) * R, cy + Math.sin(tt) * R);
    ctx.stroke();
  }
  ctx.font = FONT(700, 11);
  ctx.fillStyle = CHROME(0.95);
  ctx.textAlign = 'center';
  (['N', 'E', 'S', 'W'] as const).forEach((l, i) => {
    const tt = ((i * 90 - 90) * Math.PI) / 180;
    ctx.fillText(l, cx + Math.cos(tt) * (R + 9), cy + Math.sin(tt) * (R + 9));
  });
  const needle = (deg: number, len: number, col: string, w: number) => {
    const tt = ((deg - 90) * Math.PI) / 180;
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(tt) * len, cy + Math.sin(tt) * len);
    ctx.stroke();
  };
  needle(0, R - 2, CHROME(0.95), 1.5); // grid north
  needle(-GEO.conv, R - 10, CHROME(0.6), 1); // true north
  needle(GEO.decl - GEO.conv, R - 6, HOSTILE, 1.5); // magnetic north

  const Lm = [10, 25, 50, 100, 200, 500].find((v) => v / mpp >= 90) ?? 500;
  const Lp = Lm / mpp;
  const sx2 = W - 40;
  const sy = H - 40;
  const bx = sx2 - Lp;
  ctx.fillStyle = CHROME(0.95);
  ctx.strokeStyle = CHROME(0.95);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, sy, Lp, 5);
  ctx.fillRect(bx, sy, Lp / 2, 5);
  ctx.fillRect(bx + Lp * 0.75, sy, Lp / 4, 5);
  ctx.font = FONT(600, 10);
  ctx.fillText('0', bx, sy - 8);
  ctx.fillText(String(Lm / 2), bx + Lp / 2, sy - 8);
  ctx.fillText(`${Lm} M`, bx + Lp, sy - 8);
  ctx.restore();
}
