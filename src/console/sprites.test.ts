/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../sim';
import { TEST_FIELD } from '../maps/test-field';
import { DEFAULT_TUNE } from '../sim/tune';
import {
  barrageShells,
  CRATER_CAP,
  CRATER_VARIANTS,
  EXPLOSION_FRAMES,
  EXPLOSION_MS,
  impactLook,
  recordImpact,
  SMOKE_FADE_MS,
  type ImpactRecord,
  SHELL_EXAGGERATION,
  SHELL_PITCH_FRAMES,
  SHELL_SHADOW_FRAME,
  SHELL_WORLD_M,
  shellInFlight,
  shellTrail,
  SMOKE_PUFF_VARIANTS,
  TRAIL_PUFF_LIFE,
  sheetDimensions,
  SPRITE_SHEETS,
  type SpriteSheetSpec,
} from './sprites';

const PUBLIC_DIR = new URL('../../public/', import.meta.url);

/** Minimal RGBA8 PNG decoder using Node's built-in zlib so committed sprite sheets are verified without extra deps. */
function decodePngRgba(buf: Buffer): { width: number; height: number; pixels: Uint8Array } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) throw new Error('Not a PNG file');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Expected 8-bit RGBA PNG (colorType 6), got bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = new Uint8Array(width * height * bpp);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const byte = raw[rowIn + x]!;
      const left = x >= bpp ? pixels[rowOut + x - bpp]! : 0;
      const up = y > 0 ? pixels[rowOut - stride + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[rowOut - stride + x - bpp]! : 0;
      const recon =
        filter === 0
          ? byte
          : filter === 1
            ? byte + left
            : filter === 2
              ? byte + up
              : filter === 3
                ? byte + ((left + up) >> 1)
                : byte + paeth(left, up, upLeft);
      pixels[rowOut + x] = recon & 0xff;
    }
  }
  return { width, height, pixels };
}

function checkSheet(spec: SpriteSheetSpec) {
  const url = new URL(spec.file, PUBLIC_DIR);
  expect(existsSync(url), `${spec.file} exists under public/`).toBe(true);
  const { width, height, pixels } = decodePngRgba(readFileSync(url));
  const expected = sheetDimensions(spec);
  expect({ width, height }).toEqual({ width: expected.width, height: expected.height });

  const alphaAt = (x: number, y: number) => pixels[(y * width + x) * 4 + 3]!;

  for (let f = 0; f < spec.frames; f++) {
    const col = f % expected.cols;
    const row = Math.floor(f / expected.cols);
    const x0 = col * spec.framePx;
    const y0 = row * spec.framePx;
    // Every frame's outer perimeter must be transparent background pixels (unclipped within the cell).
    for (let i = 0; i < spec.framePx; i++) {
      expect(alphaAt(x0 + i, y0), `${spec.file} frame ${f} top edge (${i},0)`).toBe(0);
      expect(alphaAt(x0 + i, y0 + spec.framePx - 1), `${spec.file} frame ${f} bottom edge (${i},${spec.framePx - 1})`).toBe(0);
      expect(alphaAt(x0, y0 + i), `${spec.file} frame ${f} left edge (0,${i})`).toBe(0);
      expect(alphaAt(x0 + spec.framePx - 1, y0 + i), `${spec.file} frame ${f} right edge (${spec.framePx - 1},${i})`).toBe(0);
    }
    // And every frame must contain rendered non-transparent pixels.
    let opaquePixels = 0;
    for (let dy = 0; dy < spec.framePx; dy++) {
      for (let dx = 0; dx < spec.framePx; dx++) {
        if (alphaAt(x0 + dx, y0 + dy) > 16) opaquePixels++;
      }
    }
    expect(opaquePixels, `${spec.file} frame ${f} has rendered content`).toBeGreaterThan(25);
  }
}

describe('committed Asset sprite sheets', () => {
  it('registers the artillery shell sheet with 8 pitch frames plus 1 unclipped shadow frame', () => {
    expect(SHELL_PITCH_FRAMES).toBe(8);
    expect(SHELL_SHADOW_FRAME).toBe(8);
    expect(SPRITE_SHEETS['artillery-shell'].frames).toBe(9);

    const spec = SPRITE_SHEETS['artillery-shell'];
    const { width, pixels } = decodePngRgba(readFileSync(new URL(spec.file, PUBLIC_DIR)));
    const spanY = (frame: number) => {
      const x0 = frame * spec.framePx;
      let minY: number = spec.framePx;
      let maxY = -1;
      for (let y = 0; y < spec.framePx; y++) {
        for (let x = 0; x < spec.framePx; x++) {
          if (pixels[(y * width + x0 + x) * 4 + 3]! > 32) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return maxY - minY + 1;
    };
    // Level shell (frame 3) and full-length shadow (frame 8) must both span the unclipped nose-to-fin length (~100 px).
    expect(spanY(3)).toBeGreaterThanOrEqual(96);
    expect(spanY(SHELL_SHADOW_FRAME)).toBeGreaterThanOrEqual(96);
  });

  for (const [id, spec] of Object.entries(SPRITE_SHEETS)) {
    it(`${id} (${spec.file}) exists, matches expected frame count and dimensions, and has a transparent background`, () => {
      checkSheet(spec);
    });
  }
});

describe('artillery shell flight arc, shadow and fog', () => {
  const from = { x: -415, y: 0 };
  const to = { x: 50, y: -50 };

  it('launches from the friendly HQ, climbs to a distance-scaled apex, and dives into the impact spot rotated to heading', () => {
    const start = shellInFlight(from, to, 0);
    const mid = shellInFlight(from, to, 0.5);
    const end = shellInFlight(from, to, 1);

    expect({ x: start.x, y: start.y, altitude: start.altitude }).toEqual({ x: from.x, y: from.y, altitude: 0 });
    expect({ x: end.x, y: end.y, altitude: end.altitude }).toEqual({ x: to.x, y: to.y, altitude: 0 });
    expect(mid.altitude).toBeGreaterThan(0);

    // Apex scales with distance: a farther target reaches a higher apex
    const nearMid = shellInFlight(from, { x: -300, y: 0 }, 0.5);
    expect(mid.altitude).toBeGreaterThan(nearMid.altitude);

    // Pitch frames progress from climb (0) through level (middle) to dive (last pitch frame)
    expect(start.pitchFrame).toBe(0);
    expect(mid.pitchFrame).toBeGreaterThan(start.pitchFrame);
    expect(mid.pitchFrame).toBeLessThan(SHELL_PITCH_FRAMES - 1);
    expect(end.pitchFrame).toBe(SHELL_PITCH_FRAMES - 1);

    // Rotated to the heading from HQ to impact (baked sprite nose points +Y)
    const expectedHeading = Math.atan2(to.y - from.y, to.x - from.x);
    expect(mid.heading).toBeCloseTo(expectedHeading);
    expect(mid.rotation).toBeCloseTo(expectedHeading - Math.PI / 2);
  });

  it('draws at world scale with an exaggeration tune value and scales slightly with altitude', () => {
    expect(SHELL_WORLD_M).toBeGreaterThan(0);
    expect(SHELL_EXAGGERATION).toBeGreaterThan(0);
    const start = shellInFlight(from, to, 0);
    const mid = shellInFlight(from, to, 0.5);
    const end = shellInFlight(from, to, 1);
    expect(start.size).toBeCloseTo(SHELL_WORLD_M * SHELL_EXAGGERATION);
    expect(end.size).toBeCloseTo(SHELL_WORLD_M * SHELL_EXAGGERATION);
    expect(mid.size).toBeGreaterThan(start.size);
    expect(shellInFlight(from, to, 0, SHELL_EXAGGERATION * 2).size).toBeCloseTo(start.size * 2);
  });

  it('slides the shadow from a south-west offset at altitude to directly under the shell as it lands', () => {
    const mid = shellInFlight(from, to, 0.5);
    const late = shellInFlight(from, to, 0.85);
    const end = shellInFlight(from, to, 1);

    // Sun is in the north-east (45 deg), so the shadow falls south-west (-x, -y)
    expect(mid.shadow.x).toBeLessThan(mid.x);
    expect(mid.shadow.y).toBeLessThan(mid.y);

    const midOffset = Math.hypot(mid.shadow.x - mid.x, mid.shadow.y - mid.y);
    const lateOffset = Math.hypot(late.shadow.x - late.x, late.shadow.y - late.y);
    const endOffset = Math.hypot(end.shadow.x - end.x, end.shadow.y - end.y);

    expect(midOffset).toBeGreaterThan(lateOffset);
    expect(lateOffset).toBeGreaterThan(0);
    expect(endOffset).toBeCloseTo(0);
    expect({ x: end.shadow.x, y: end.shadow.y }).toEqual({ x: to.x, y: to.y });
  });

  it('surfaces friendly shells from the Commander HQ and never shows enemy shells or launch sources', () => {
    const tune = { ...DEFAULT_TUNE, barrageCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [
      { tick: m.tick, side: 'nato', kind: 'asset', asset: 'barrage', at: { x: 40, y: 20 } },
      { tick: m.tick, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: -40, y: -20 } },
    ]);
    // Advance into the flight window (after 2.5 s warning)
    const ticks = Math.round((tune.barrageWarningSeconds + 0.5) * tune.hz);
    for (let i = 0; i < ticks; i++) step(m, []);

    const natoView = commanderView(m, 'nato');
    const natoShells = barrageShells(natoView, TEST_FIELD);
    expect(natoShells.length).toBeGreaterThan(0);
    // Every shown shell arcs from NATO's HQ toward NATO's target, never Pact's HQ
    for (const s of natoShells) {
      expect(s.from).toEqual({ x: TEST_FIELD.hqs.nato.x, y: TEST_FIELD.hqs.nato.y });
      expect(Math.hypot(s.to.x - 40, s.to.y - 20)).toBeLessThanOrEqual(tune.barrageSpreadM);
    }

    // If only the enemy called a barrage, the Commander's view has no shells at all
    const mEnemyOnly = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(mEnemyOnly, [{ tick: mEnemyOnly.tick, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: -40, y: -20 } }]);
    for (let i = 0; i < ticks; i++) step(mEnemyOnly, []);
    expect(barrageShells(commanderView(mEnemyOnly, 'nato'), TEST_FIELD)).toEqual([]);
  });
});

describe('shell smoke trail', () => {
  const from = { x: -415, y: 0 };
  const to = { x: 50, y: -50 };

  it('registers the baked smoke puff sheet', () => {
    expect(SPRITE_SHEETS['smoke-puff'].frames).toBe(SMOKE_PUFF_VARIANTS);
  });

  it('has no puffs before the shell leaves and grows as it flies', () => {
    expect(shellTrail(from, to, 0)).toEqual([]);
    expect(shellTrail(from, to, 0.2).length).toBeGreaterThan(3);
  });

  it('never draws a puff ahead of the shell', () => {
    for (const u of [0.05, 0.3, 0.5, 0.7, 0.95, 1]) {
      const shell = shellInFlight(from, to, u);
      const hx = Math.cos(shell.heading);
      const hy = Math.sin(shell.heading);
      for (const p of shellTrail(from, to, u)) {
        expect((p.x - shell.x) * hx + (p.y - shell.y) * hy, `puff ahead of shell at flight ${u}`).toBeLessThan(0);
      }
    }
  });

  it('leaves each puff where it was emitted, fading and swelling on its own until it is gone', () => {
    const early = shellTrail(from, to, 0.3);
    const later = shellTrail(from, to, 0.35);
    const newest = early.at(-1)!;
    const same = later.find((p) => p.id === newest.id)!;
    expect({ x: same.x, y: same.y, frame: same.frame }).toEqual({ x: newest.x, y: newest.y, frame: newest.frame });
    expect(same.opacity).toBeLessThan(newest.opacity);
    expect(same.size).toBeGreaterThan(newest.size);

    // Puffs older than their lifetime are gone, so the trail is a fading tail, not a route back to the HQ.
    const oldest = shellTrail(from, to, 0.9)[0]!;
    expect(oldest.emitted).toBeGreaterThanOrEqual(0.9 - TRAIL_PUFF_LIFE);
    for (const p of shellTrail(from, to, 0.9)) expect(p.frame).toBeLessThan(SMOKE_PUFF_VARIANTS);
  });
});

describe('shell impact: explosion, drifting plume and lasting crater', () => {
  const hit = (at = 0): ImpactRecord => recordImpact([], 50, -50, at).at(-1)!;

  it('registers the baked explosion flipbook and crater decal sheets', () => {
    expect(SPRITE_SHEETS.explosion.frames).toBe(EXPLOSION_FRAMES);
    expect(EXPLOSION_FRAMES).toBeGreaterThanOrEqual(16);
    expect(EXPLOSION_FRAMES).toBeLessThanOrEqual(32);
    expect(SPRITE_SHEETS.crater.frames).toBe(CRATER_VARIANTS);
  });

  it('plays the flipbook once from the first frame at the impact spot, then it is gone', () => {
    const i = hit(1000);
    const first = impactLook(i, 1000).explosion!;
    expect({ frame: first.frame, x: first.x, y: first.y, opacity: first.opacity }).toEqual({ frame: 0, x: 50, y: -50, opacity: 1 });
    let last = 0;
    for (let t = 0; t < EXPLOSION_MS; t += 40) {
      const e = impactLook(i, 1000 + t).explosion!;
      expect(e.frame).toBeGreaterThanOrEqual(last);
      last = e.frame;
    }
    expect(last).toBe(EXPLOSION_FRAMES - 1);
    expect(impactLook(i, 1000 + EXPLOSION_MS).explosion).toBeNull();
  });

  it('hands the explosion over to a plume that drifts downwind, swells and fades out by the smoke fade', () => {
    const i = hit();
    expect(impactLook(i, 0).plume.every((p) => p.opacity === 0)).toBe(true);
    const handover = impactLook(i, EXPLOSION_MS - 60);
    expect(handover.explosion!.opacity).toBeLessThan(1);
    expect(Math.max(...handover.plume.map((p) => p.opacity))).toBeGreaterThan(0);

    const early = impactLook(i, EXPLOSION_MS + 1000).plume;
    const late = impactLook(i, SMOKE_FADE_MS * 0.7).plume;
    expect(late).toHaveLength(early.length);
    early.forEach((p, k) => {
      const q = late[k]!;
      expect(Math.hypot(q.x - 50, q.y + 50)).toBeGreaterThan(Math.hypot(p.x - 50, p.y + 50));
      expect(q.size).toBeGreaterThan(p.size);
      expect(q.opacity).toBeLessThan(p.opacity);
      expect(p.frame).toBeLessThan(SMOKE_PUFF_VARIANTS);
    });
    expect(impactLook(i, SMOKE_FADE_MS).plume).toEqual([]);
  });

  it('leaves a crater that stays for the match', () => {
    const i = hit();
    const c = impactLook(i, 0).crater;
    expect({ x: c.x, y: c.y }).toEqual({ x: 50, y: -50 });
    expect(c.frame).toBeLessThan(CRATER_VARIANTS);
    expect(impactLook(i, 30 * 60 * 1000).crater).toEqual(c);
  });

  it('keeps at most CRATER_CAP impacts, removing the oldest first', () => {
    const list: ImpactRecord[] = [];
    for (let k = 0; k < CRATER_CAP + 5; k++) recordImpact(list, k, 0, k);
    expect(list).toHaveLength(CRATER_CAP);
    expect(list[0]!.x).toBe(5);
    expect(list.at(-1)!.x).toBe(CRATER_CAP + 4);
  });
});
