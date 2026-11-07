/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sheetDimensions, type SpriteSheetSpec } from './sheet';
import { SHELL_HEADINGS, SHELL_PITCH_FRAMES, SHELL_SHADOW_FRAME, SHELL_SHEET } from './shell';

const PUBLIC_DIR = new URL('../../../public/', import.meta.url);

// Every sheet an Asset module beside this file exports (#77): a new Asset registers its sheet by exporting it, nothing else.
const modules = import.meta.glob<Record<string, unknown>>(['./*.ts', '!./*.test.ts'], { eager: true });
const isSheet = (v: unknown): v is SpriteSheetSpec => typeof v === 'object' && v !== null && 'file' in v && 'frames' in v && 'framePx' in v;
const SHEETS = Object.values(modules).flatMap((m) => Object.values(m).filter(isSheet));

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
  it('has an Asset module registering every sheet .json a Blender script wrote under public/', () => {
    const baked = readdirSync(PUBLIC_DIR, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.json') && 'frames' in JSON.parse(readFileSync(new URL(f, PUBLIC_DIR), 'utf8')))
      .map((f) => f.replace(/\.json$/, '.png'))
      .sort();
    expect(SHEETS.map((s) => s.file).sort()).toEqual(baked);
  });

  it('registers the artillery shell sheet: 8 pitch rows of 16 baked headings plus 1 unclipped shadow frame', () => {
    expect(SHELL_PITCH_FRAMES).toBe(8);
    expect(SHELL_HEADINGS).toBe(16);
    expect(SHELL_SHADOW_FRAME).toBe(SHELL_PITCH_FRAMES * SHELL_HEADINGS);
    expect(SHELL_SHEET.frames).toBe(SHELL_PITCH_FRAMES * SHELL_HEADINGS + 1);

    const spec = SHELL_SHEET;
    const { cols } = sheetDimensions(spec);
    const { width, pixels } = decodePngRgba(readFileSync(new URL(spec.file, PUBLIC_DIR)));
    const spanY = (frame: number) => {
      const x0 = (frame % cols) * spec.framePx;
      const y0 = Math.floor(frame / cols) * spec.framePx;
      let minY: number = spec.framePx;
      let maxY = -1;
      for (let y = 0; y < spec.framePx; y++) {
        for (let x = 0; x < spec.framePx; x++) {
          if (pixels[((y0 + y) * width + x0 + x) * 4 + 3]! > 32) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return maxY - minY + 1;
    };
    // Level shell flying north (pitch 3, heading 4 = 90 deg) and the full-length shadow both span the unclipped
    // nose-to-fin length (~100 px).
    expect(spanY(3 * SHELL_HEADINGS + 4)).toBeGreaterThanOrEqual(96);
    expect(spanY(SHELL_SHADOW_FRAME)).toBeGreaterThanOrEqual(96);
  });

  for (const spec of SHEETS) {
    it(`${spec.file} exists, matches expected frame count and dimensions, and has a transparent background`, () => {
      checkSheet(spec);
    });

    it(`${spec.file} matches the layout and constants its Blender script baked (sheet .json beside the PNG)`, () => {
      const url = new URL(spec.file.replace(/\.png$/, '.json'), PUBLIC_DIR);
      expect(existsSync(url), `${spec.file}: rerun its build.py to write the sheet .json`).toBe(true);
      const baked = JSON.parse(readFileSync(url, 'utf8')) as {
        frames: number;
        framePx: number;
        cols: number;
        constants?: Record<string, number>;
      };
      expect({ frames: spec.frames, framePx: spec.framePx, cols: sheetDimensions(spec).cols }).toEqual({
        frames: baked.frames,
        framePx: baked.framePx,
        cols: baked.cols,
      });
      for (const [name, value] of Object.entries(baked.constants ?? {})) {
        const actual = spec.constants?.[name];
        expect(typeof actual, `${spec.file}'s sheet lists ${name} under constants`).toBe('number');
        expect(actual, `${name} matches the bake`).toBeCloseTo(value, 3);
      }
    });
  }
});
