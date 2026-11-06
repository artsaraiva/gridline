import { describe, expect, it } from 'vitest';
import { PULSE_MS, pulseAt, pulseColor, REST_BRIGHTNESS } from './pulse';

const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const;
const spread = (c: number) => Math.max(...rgb(c)) - Math.min(...rgb(c));
const FRIENDLY = 0x6fd0ff;
const HOSTILE = 0xff4b3e;

describe('firing pulse', () => {
  it('is full at the shot and gone by PULSE_MS, decaying in between', () => {
    expect(pulseAt(0)).toBe(1);
    expect(pulseAt(PULSE_MS)).toBe(0);
    expect(pulseAt(PULSE_MS * 10)).toBe(0);
    expect(pulseAt(-1)).toBe(0); // no shot yet
    let last = 1;
    for (let age = 16; age < PULSE_MS; age += 16) {
      expect(pulseAt(age)).toBeLessThan(last);
      expect(pulseAt(age)).toBeGreaterThan(0);
      last = pulseAt(age);
    }
  });

  it('rests calmer and darker than the palette colour, keeping its hue (#54)', () => {
    for (const color of [FRIENDLY, HOSTILE]) {
      const rest = pulseColor(color, 0);
      expect(rest).not.toBe(color);
      expect(spread(rest)).toBeLessThan(spread(color));
      expect(spread(rest)).toBeGreaterThan(0);
      const [r, g, b] = rgb(color);
      const [rr, rg, rb] = rgb(rest);
      expect(Math.sign(rr - rg)).toBe(Math.sign(r - g));
      expect(Math.sign(rg - rb)).toBe(Math.sign(g - b));
      expect(Math.max(...rgb(rest))).toBeLessThanOrEqual(Math.max(...rgb(color)) * REST_BRIGHTNESS + 1);
    }
    expect(REST_BRIGHTNESS).toBeLessThan(1);
    expect(pulseColor(0x808080, 0)).toBe(Math.round(0x80 * REST_BRIGHTNESS) * 0x010101); // grey only darkens
  });

  it('peaks at least as bright as the palette colour in every channel', () => {
    for (const color of [FRIENDLY, HOSTILE]) {
      const peak = rgb(pulseColor(color, 1));
      rgb(color).forEach((v, i) => expect(peak[i]).toBeGreaterThanOrEqual(v));
      expect(Math.max(...peak)).toBeLessThanOrEqual(255);
    }
  });

  it('is halfway between rest and peak at half strength', () => {
    const [rest, mid, peak] = [0, 0.5, 1].map((p) => rgb(pulseColor(HOSTILE, p)));
    for (let i = 0; i < 3; i++) expect(Math.abs(mid![i]! - (rest![i]! + peak![i]!) / 2)).toBeLessThanOrEqual(1);
  });
});
