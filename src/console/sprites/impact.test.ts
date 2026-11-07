import { describe, expect, it } from 'vitest';
import { CRATER_CAP, CRATER_SHEET, CRATER_VARIANTS, EXPLOSION_FRAMES, EXPLOSION_MS, EXPLOSION_SHEET, impactLook, type ImpactRecord, recordImpact, SMOKE_FADE_MS } from './impact';
import { SMOKE_PUFF_VARIANTS } from './smoke-puff';

describe('shell impact: explosion, drifting plume and lasting crater', () => {
  const hit = (at = 0): ImpactRecord => recordImpact([], 50, -50, at, 'barrage').at(-1)!;

  it('registers the baked explosion flipbook and crater decal sheets', () => {
    expect(EXPLOSION_SHEET.frames).toBe(EXPLOSION_FRAMES);
    expect(EXPLOSION_FRAMES).toBeGreaterThanOrEqual(16);
    expect(EXPLOSION_FRAMES).toBeLessThanOrEqual(32);
    expect(CRATER_SHEET.frames).toBe(CRATER_VARIANTS);
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
    for (let k = 0; k < CRATER_CAP + 5; k++) recordImpact(list, k, 0, k, 'barrage');
    expect(list).toHaveLength(CRATER_CAP);
    expect(list[0]!.x).toBe(5);
    expect(list.at(-1)!.x).toBe(CRATER_CAP + 4);
  });
});
