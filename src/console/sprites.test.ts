/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { commanderView, createMatch, step } from '../sim';
import { TEST_FIELD } from '../maps/test-field';
import { DEFAULT_TUNE } from '../sim/tune';
import * as sprites from './sprites';
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
  type ShellInFlight,
  SHELL_EXAGGERATION,
  SHELL_PITCH_FRAMES,
  SHELL_HEADINGS,
  SHELL_SHADOW_FRAME,
  SHELL_WORLD_M,
  shellInFlight,
  shellStreak,
  SHELL_VISIBLE_FROM,
  SMOKE_PUFF_VARIANTS,
  sheetDimensions,
  SPRITE_SHEETS,
  SUPPLY_LANDED_FRAME,
  SUPPLY_SHADOW_FRAME,
  SUPPLY_SWING_FRAMES,
  supplyDrop,
  type SpriteSheetSpec,
  scanUav,
  UAV_EXAGGERATION,
  UAV_HEADINGS,
  UAV_SHADOW_FRAME,
  UAV_WORLD_M,
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
  it('registers the artillery shell sheet: 8 pitch rows of 16 baked headings plus 1 unclipped shadow frame', () => {
    expect(SHELL_PITCH_FRAMES).toBe(8);
    expect(SHELL_HEADINGS).toBe(16);
    expect(SHELL_SHADOW_FRAME).toBe(SHELL_PITCH_FRAMES * SHELL_HEADINGS);
    expect(SPRITE_SHEETS['artillery-shell'].frames).toBe(SHELL_PITCH_FRAMES * SHELL_HEADINGS + 1);

    const spec = SPRITE_SHEETS['artillery-shell'];
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

  for (const [id, spec] of Object.entries(SPRITE_SHEETS)) {
    it(`${id} (${spec.file}) exists, matches expected frame count and dimensions, and has a transparent background`, () => {
      checkSheet(spec);
    });

    it(`${id} matches the layout and constants its Blender script baked (sheet .json beside the PNG)`, () => {
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
        const actual = (sprites as unknown as Record<string, unknown>)[name];
        expect(typeof actual, `sprites.ts exports ${name}`).toBe('number');
        expect(actual as number, `${name} in sprites.ts matches the bake`).toBeCloseTo(value, 3);
      }
    });
  }
});

describe('artillery shell sky entry, streak and fog', () => {
  const from = { x: -415, y: 0 };
  const to = { x: 50, y: -50 };

  it('is drawn only in the last part of its flight: it enters high over a spot short of the target toward the own HQ and falls straight to it', () => {
    const start = shellInFlight(from, to, SHELL_VISIBLE_FROM);
    const mid = shellInFlight(from, to, (1 + SHELL_VISIBLE_FROM) / 2);
    const end = shellInFlight(from, to, 1);

    // Before the visible window the pose is held at the entry: nothing is drawn yet
    const pose = ({ flight: _, ...rest }: ShellInFlight) => rest;
    expect(pose(shellInFlight(from, to, 0))).toEqual(pose(start));
    expect(pose(shellInFlight(from, to, SHELL_VISIBLE_FROM / 2))).toEqual(pose(start));

    // #98: the first visible frame is high above a ground spot short of the target, on the bearing toward the own HQ
    expect(start.altitude).toBeGreaterThan(0);
    expect(start.ground.x).toBeLessThan(to.x);
    expect(Math.hypot(start.ground.x - from.x, start.ground.y - from.y)).toBeLessThan(Math.hypot(to.x - from.x, to.y - from.y));
    expect(Math.hypot(start.ground.x - to.x, start.ground.y - to.y)).toBeCloseTo(start.altitude / Math.tan(Math.PI / 3)); // 60 deg
    expect({ x: end.x, y: end.y, altitude: end.altitude }).toEqual({ x: to.x, y: to.y, altitude: 0 });
    expect(mid.altitude).toBeCloseTo(start.altitude / 2);

    // A straight line: the body's mid point sits half way between its first and last frame
    expect(mid.x).toBeCloseTo((start.x + end.x) / 2);
    expect(mid.y).toBeCloseTo((start.y + end.y) / 2);

    // Always diving: the steepest baked pitch
    expect(start.pitchFrame).toBe(SHELL_PITCH_FRAMES - 1);
    expect(end.pitchFrame).toBe(SHELL_PITCH_FRAMES - 1);

    // Rotated to the heading from HQ to impact (baked sprite nose points +Y)
    const expectedHeading = Math.atan2(to.y - from.y, to.x - from.x);
    expect(mid.heading).toBeCloseTo(expectedHeading);
    expect(mid.rotation).toBeCloseTo(expectedHeading - Math.PI / 2);
  });

  it('a shot 50 m from the HQ and one 800 m away take the same visible path shape', () => {
    const near = shellInFlight({ x: -50, y: 0 }, { x: 0, y: 0 }, 0.9);
    const far = shellInFlight({ x: -800, y: 0 }, { x: 0, y: 0 }, 0.9);
    expect({ x: near.x, y: near.y, altitude: near.altitude, size: near.size }).toEqual({ x: far.x, y: far.y, altitude: far.altitude, size: far.size });
  });

  it('keeps the baked sun north-east in any flight direction: nearest baked heading frame, only the remainder rotated', () => {
    const step = (2 * Math.PI) / SHELL_HEADINGS;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    for (let a = -Math.PI; a < Math.PI; a += 0.29) {
      const s = shellInFlight({ x: 0, y: 0 }, { x: Math.cos(a) * 300, y: Math.sin(a) * 300 }, 0.9);
      const heading = s.frame % SHELL_HEADINGS;
      expect(Math.floor(s.frame / SHELL_HEADINGS)).toBe(s.pitchFrame);
      expect(Math.abs(s.bodyRotation)).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(wrap(heading * step + s.bodyRotation - s.heading)).toBeCloseTo(0);
    }
    // A Pact shell flying west uses the west-facing frames rather than the east-facing frames turned half a circle.
    const west = shellInFlight({ x: 415, y: 0 }, { x: -50, y: 0 }, 0.9);
    expect(west.frame % SHELL_HEADINGS).toBe(SHELL_HEADINGS / 2);
    expect(west.bodyRotation).toBeCloseTo(0);
  });

  it('is a small dark dot at world scale with an exaggeration tune value, and shrinks as it drops', () => {
    expect(SHELL_WORLD_M).toBeGreaterThan(0);
    expect(SHELL_EXAGGERATION).toBeGreaterThan(0);
    expect(SHELL_EXAGGERATION).toBeLessThanOrEqual(2.5); // a 155 mm round, not a rocket
    const start = shellInFlight(from, to, SHELL_VISIBLE_FROM);
    const mid = shellInFlight(from, to, 0.9);
    const end = shellInFlight(from, to, 1);
    expect(end.size).toBeCloseTo(SHELL_WORLD_M * SHELL_EXAGGERATION);
    expect(start.size).toBeGreaterThan(mid.size);
    expect(mid.size).toBeGreaterThan(end.size);
    expect(shellInFlight(from, to, 1, SHELL_EXAGGERATION * 2).size).toBeCloseTo(end.size * 2);
  });

  it('surfaces friendly shells in their visible window, bearing from the Commander HQ, and never enemy shells or launch sources', () => {
    const tune = { ...DEFAULT_TUNE, barrageCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [
      { tick: m.tick, side: 'nato', kind: 'asset', asset: 'barrage', at: { x: 40, y: 20 } },
      { tick: m.tick, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: -40, y: -20 } },
    ]);
    // Just after the first shell leaves it is up but not yet drawn
    const early = Math.round((tune.barrageWarningSeconds + 0.5) * tune.hz);
    for (let i = 0; i < early; i++) step(m, []);
    expect(commanderView(m, 'nato').effects![0]!.shells!.length).toBeGreaterThan(0);
    expect(barrageShells(commanderView(m, 'nato'), TEST_FIELD)).toEqual([]);
    // In the last part of its flight it is
    const late = Math.round((tune.barrageFlightSeconds * (1 - SHELL_VISIBLE_FROM) * 0.5) * tune.hz);
    for (let i = 0; i < Math.round(tune.barrageFlightSeconds * tune.hz) - early + Math.round(tune.barrageWarningSeconds * tune.hz) - late; i++) step(m, []);
    const natoView = commanderView(m, 'nato');
    const natoShells = barrageShells(natoView, TEST_FIELD);
    expect(natoShells.length).toBeGreaterThan(0);
    // Every shown shell comes in on the bearing from NATO's HQ toward NATO's target, never Pact's HQ
    for (const s of natoShells) {
      expect(s.from).toEqual({ x: TEST_FIELD.hqs.nato.x, y: TEST_FIELD.hqs.nato.y });
      expect(Math.hypot(s.to.x - 40, s.to.y - 20)).toBeLessThanOrEqual(tune.barrageSpreadM);
    }

    // If only the enemy called a barrage, the Commander's view has no shells at all
    const mEnemyOnly = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(mEnemyOnly, [{ tick: mEnemyOnly.tick, side: 'pact', kind: 'asset', asset: 'barrage', at: { x: -40, y: -20 } }]);
    for (let i = 0; i < Math.round((tune.barrageWarningSeconds + tune.barrageFlightSeconds - 0.2) * tune.hz); i++) step(mEnemyOnly, []);
    expect(barrageShells(commanderView(mEnemyOnly, 'nato'), TEST_FIELD)).toEqual([]);
  });
});

describe('shell streak', () => {
  const from = { x: -415, y: 0 };
  const to = { x: 50, y: -50 };

  it('runs from the entry spot to the shell, so it grows as the shell falls and ends at the target', () => {
    const entry = shellInFlight(from, to, SHELL_VISIBLE_FROM);
    const early = shellStreak(from, to, 0.85);
    const late = shellStreak(from, to, 1);
    expect({ x: early.tail.x, y: early.tail.y }).toEqual({ x: entry.x, y: entry.y });
    expect({ x: late.tail.x, y: late.tail.y }).toEqual({ x: entry.x, y: entry.y });
    expect({ x: late.head.x, y: late.head.y }).toEqual({ x: to.x, y: to.y });
    expect(late.length).toBeGreaterThan(early.length);
    expect(late.length).toBeCloseTo(Math.hypot(to.x - entry.x, to.y - entry.y));
    expect(late.angle).toBeCloseTo(Math.atan2(to.y - entry.y, to.x - entry.x));
  });

  it('has no length before the shell is drawn', () => {
    expect(shellStreak(from, to, 0).length).toBe(0);
    expect(shellStreak(from, to, SHELL_VISIBLE_FROM).length).toBe(0);
  });
});

describe('Scan UAV circling its orbit', () => {
  const center = { x: 120, y: 120 };
  const radius = 60;
  const step = (2 * Math.PI) / UAV_HEADINGS;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  it('registers the baked UAV sheet: one frame per baked heading plus a shadow frame', () => {
    expect(UAV_SHADOW_FRAME).toBe(UAV_HEADINGS);
    expect(SPRITE_SHEETS['scan-uav'].frames).toBe(UAV_HEADINGS + 1);
  });

  it('flies counter-clockwise on the scan ring, nose along the orbit tangent', () => {
    for (const t of [0, 1.3, 4, 9.7, 30]) {
      const u = scanUav(center, radius, t);
      const rx = u.x - center.x;
      const ry = u.y - center.y;
      expect(Math.hypot(rx, ry)).toBeCloseTo(radius);
      const hx = Math.cos(u.heading);
      const hy = Math.sin(u.heading);
      expect(rx * hx + ry * hy).toBeCloseTo(0); // tangent
      expect(rx * hy - ry * hx).toBeGreaterThan(0); // counter-clockwise
    }
    const a = scanUav(center, radius, 0);
    const b = scanUav(center, radius, 1);
    expect({ x: a.x, y: a.y }).not.toEqual({ x: b.x, y: b.y });
  });

  it('picks the nearest baked heading frame so the baked sun stays in the north-east, and rotates only the remainder', () => {
    for (let t = 0; t < 40; t += 0.37) {
      const u = scanUav(center, radius, t);
      expect(Number.isInteger(u.frame)).toBe(true);
      expect(u.frame).toBeGreaterThanOrEqual(0);
      expect(u.frame).toBeLessThan(UAV_HEADINGS);
      expect(Math.abs(u.rotation)).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(wrap(u.frame * step + u.rotation - u.heading)).toBeCloseTo(0);
    }
  });

  it('draws at world scale with an exaggeration tune value and casts its shadow south-west, turned with the aircraft', () => {
    const u = scanUav(center, radius, 2);
    expect(u.size).toBeCloseTo(UAV_WORLD_M * UAV_EXAGGERATION);
    expect(scanUav(center, radius, 2, UAV_EXAGGERATION * 2).size).toBeCloseTo(u.size * 2);
    expect(u.shadow.x).toBeLessThan(u.x);
    expect(u.shadow.y).toBeLessThan(u.y);
    expect(u.shadow.x - u.x).toBeCloseTo(u.shadow.y - u.y);
    expect(u.shadow.rotation).toBeCloseTo(u.heading);
  });
});

describe('supply drop under its parachute', () => {
  const spot = { x: -120, y: 120 };
  const fall = 5;
  const at = (landsIn: number) => supplyDrop({ ...spot, landsIn, fall });
  const crateOff = (p: ReturnType<typeof supplyDrop>) => Math.hypot(p.crate.x - spot.x, p.crate.y - spot.y);
  const shadowOff = (p: ReturnType<typeof supplyDrop>) => Math.hypot(p.shadow.crate.x - p.crate.x, p.shadow.crate.y - p.crate.y);

  it('registers the baked sheet: swing frames, then the falling shadow, then the landed crate', () => {
    expect(SUPPLY_SHADOW_FRAME).toBe(SUPPLY_SWING_FRAMES);
    expect(SUPPLY_LANDED_FRAME).toBe(SUPPLY_SWING_FRAMES + 1);
    expect(SPRITE_SHEETS['supply-drop'].frames).toBe(SUPPLY_SWING_FRAMES + 2);
  });

  it('comes down toward its spot with its shadow closing in from the south-west, then sits on the spot', () => {
    const high = at(fall);
    const low = at(1);
    const down = at(0);
    expect(high.landed).toBe(false);
    expect(high.altitude).toBeGreaterThan(low.altitude);
    // Higher is drawn north-east of the spot (sun in the NE), and its shadow falls south-west of it.
    expect(high.crate.x).toBeGreaterThan(spot.x);
    expect(high.crate.y).toBeGreaterThan(spot.y);
    expect(high.shadow.crate.x).toBeLessThan(high.crate.x);
    expect(high.shadow.crate.y).toBeLessThan(high.crate.y);
    expect(crateOff(high)).toBeGreaterThan(crateOff(low));
    expect(shadowOff(high)).toBeGreaterThan(shadowOff(low));
    expect(high.size).toBeGreaterThan(low.size);
    expect(high.shadow.opacity).toBeLessThan(low.shadow.opacity);

    expect(down.landed).toBe(true);
    expect(down.frame).toBe(SUPPLY_LANDED_FRAME);
    expect({ x: down.x, y: down.y, altitude: down.altitude }).toEqual({ ...spot, altitude: 0 });
  });

  it('swings under the canopy through the swing frames while falling', () => {
    const frames = new Set<number>();
    for (let t = 0; t < fall; t += 0.1) frames.add(at(fall - t).frame);
    expect([...frames].every((f) => f >= 0 && f < SUPPLY_SWING_FRAMES)).toBe(true);
    expect(frames.size).toBe(SUPPLY_SWING_FRAMES);
  });

  it('follows the Simulation: falling while the crate is in the air, landed once it is down', () => {
    const tune = { ...DEFAULT_TUNE, supplyCooldownSeconds: 0 };
    const m = createMatch({ seed: 1, map: TEST_FIELD, tune, squadsPerSide: 1, commanderSide: 'nato' });
    step(m, [{ tick: m.tick, side: 'nato', kind: 'asset', asset: 'supply', at: { x: 40, y: 20 } }]);
    const pose = () => {
      const e = commanderView(m, 'nato').effects!.find((f) => f.asset === 'supply')!;
      return supplyDrop({ x: e.x, y: e.y, landsIn: e.landsIn!, fall: e.fall! });
    };
    expect(pose().landed).toBe(false);
    for (let i = 0; i < (tune.supplyFallSeconds + 0.5) * tune.hz; i++) step(m, []);
    expect(pose()).toMatchObject({ landed: true, x: 40, y: 20 });
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

  it('is big: the flash spans well over the kill ring, the plume more than the crater', () => {
    const look = impactLook(hit(), EXPLOSION_MS / 2);
    expect(look.explosion!.size).toBeGreaterThanOrEqual(50);
    expect(Math.max(...impactLook(hit(), EXPLOSION_MS + 1000).plume.map((p) => p.size))).toBeGreaterThan(look.crater.size * 2);
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
