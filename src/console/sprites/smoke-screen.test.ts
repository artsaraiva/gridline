import { describe, expect, it } from 'vitest';
import { smokeLook } from './smoke-screen';

const disc = (o: Partial<{ r: number; age: number; density: number }> = {}) => ({ x: 30, y: -15, r: 7.5, age: 20, density: 1, ...o });

describe('Smoke Screen look (#138)', () => {
  it('a blot wider than the disc, on its spot, under six puffs', () => {
    const [blot, ...puffs] = smokeLook(disc(), 0);
    expect(blot).toMatchObject({ x: 30, y: -15 });
    expect(blot!.size).toBeGreaterThan(15);
    expect(puffs).toHaveLength(6);
  });

  it('the blot grows with the disc as it blooms', () => {
    expect(smokeLook(disc({ r: 3 }), 0)[0]!.size).toBeLessThan(smokeLook(disc({ r: 7.5 }), 0)[0]!.size);
  });

  it('everything dims as the disc thins, to nothing', () => {
    const full = smokeLook(disc(), 0);
    const half = smokeLook(disc({ density: 0.5 }), 0);
    full.forEach((s, k) => expect(half[k]!.opacity).toBeCloseTo(s.opacity / 2));
    expect(smokeLook(disc({ density: 0 }), 0).every((s) => s.opacity === 0)).toBe(true);
  });

  it('the puffs move: a puff rides the wind east as it rises, and is born somewhere new the next time', () => {
    const at = (age: number) => smokeLook(disc({ age }), 0)[1]!;
    const lifeStart = [...Array(71).keys()].map((n) => n / 10).find((age) => at(age + 0.1).size < at(age).size)! + 0.1; // the first rebirth
    expect(at(lifeStart + 3).x).toBeGreaterThan(at(lifeStart + 1).x);
    expect(at(lifeStart + 3).size).toBeGreaterThan(at(lifeStart + 1).size);
    expect([at(lifeStart + 1).frame, at(lifeStart + 1).y - 0.25]).not.toEqual([at(lifeStart + 8).frame, at(lifeStart + 8).y - 0.25]);
  });

  it('two discs of one wall do not look alike', () => {
    expect(smokeLook(disc(), 0).map((s) => s.frame + s.x)).not.toEqual(smokeLook({ ...disc(), y: 0 }, 1).map((s) => s.frame + s.x));
  });
});
