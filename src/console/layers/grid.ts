// Grid overlay: map grid lines clipped to the map, the grid letters over the map's top edge and the grid numbers left of
// its left edge (as on a chess board: they belong to the map, so no panel moves them), the scale bar, the cursor readout,
// and a screen-wide crosshair through the selected Squad's leader (#92, as BF4 Commander: two thin lines that stop at the
// leader's bracket, no intersection tags).
import type { CommanderView } from '../../sim/types';
import { LAYOUT } from '../chrome/rail';
import { pxToWorld, toScreen } from '../renderer';
import { session } from '../session';
import { cursorReadout, leaderOf } from '../summary';
import { targeting } from '../targeting';
import { BRACKET } from './chevrons';
import { UNIT_PX } from './symbols';

const canvas = document.getElementById('hud') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const curEl = document.getElementById('cur')!;

const FONT = (weight: number, px: number) => `${weight} ${px}px 'Chakra Petch', ui-monospace, monospace`;
const CHROME = (a: number) => `rgba(232, 226, 200, ${a})`;
const LABEL_GAP = 13; // px from the map's edge to its labels

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

/** Draws the grid, its labels, the crosshair, the scale bar and the cursor readout; hides them between matches. */
export function drawGrid(view: CommanderView | null) {
  syncCanvas();
  const g = session.host?.map.grid;
  // The readout answers "where is my pointer from this Squad / for this Asset", so it shows only while one is in hand
  const curText = view && (targeting.selected !== null || targeting.armed) ? cursorReadout(targeting.pointer, view, g, targeting.selected) : '';
  curEl.hidden = !curText;
  if (curEl.textContent !== curText) curEl.textContent = curText;
  if (!view) return;

  const W = cw;
  const H = ch;

  if (g) {
    const halfW = (g.cols * g.squareM) / 2;
    const halfH = (g.rows * g.squareM) / 2;
    const tl = toScreen({ x: -halfW, y: halfH });
    const br = toScreen({ x: halfW, y: -halfH });

    // 1. Faint map grid lines, stopping at the map's edge
    ctx.save();
    ctx.beginPath();
    ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = CHROME(0.08);
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
    ctx.restore();

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

    // 3. Grid letters and numbers on the map's own edges, in the space `fitView` leaves for them. An edge that is off
    // screen pins them to a fixed line: letters under the score strip, numbers right of the Asset rail.
    const ly = Math.max(tl.y - LABEL_GAP, LAYOUT.top - LABEL_GAP);
    const lx = Math.max(tl.x - LABEL_GAP, LAYOUT.margin + LAYOUT.assetRail + LABEL_GAP);
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = CHROME(0.6);
    ctx.font = FONT(700, 13);
    for (let i = 0; i < g.cols; i++) {
      const sx = toScreen({ x: -halfW + (i + 0.5) * g.squareM, y: 0 }).x;
      if (sx > lx + 10 && sx < W - LAYOUT.margin - LAYOUT.squadRail - 10) ctx.fillText(g.letters[i]!, sx, ly);
    }
    for (let j = 0; j < g.rows; j++) {
      const sy = toScreen({ x: 0, y: halfH - (j + 0.5) * g.squareM }).y;
      if (sy > ly + 10 && sy < H - 8) ctx.fillText(String(j + 1), lx, sy);
    }
    ctx.restore();
  }

  // 4. Scale bar bottom-right
  const mpp = pxToWorld();
  const Lm = [10, 25, 50, 100, 200, 500].find((v) => v / mpp >= 90) ?? 500;
  const Lp = Lm / mpp;
  const sy = H - 40;
  const bx = W - 40 - Lp;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 4;
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
