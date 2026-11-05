import { describe, expect, it } from 'vitest';
import { atFallback, frameBudget, playStart } from './quality';

describe('playStart', () => {
  it('uses the 8192 level when the GPU holds it and frames are fine', () => expect(playStart(14, 16384, false)).toBe(0));
  it('exactly 8192 is enough', () => expect(playStart(14, 8192, false)).toBe(0));
  it('starts at 4096 when the GPU lacks 8192 textures', () => expect(playStart(14, 4096, false)).toBe(1));
  it('goes lower still on a GPU that cannot hold 4096', () => expect(playStart(14, 2048, false)).toBe(2));
  it('starts at 4096 when the budget was missed', () => expect(playStart(14, 16384, true)).toBe(1));
  it('never runs off the end of the chain', () => expect(playStart(3, 1, true)).toBe(2));
});

describe('atFallback', () => {
  it('is false at 8192, true at 4096 and below', () => {
    expect(atFallback(14, 0)).toBe(false);
    expect(atFallback(14, 1)).toBe(true);
    expect(atFallback(14, 2)).toBe(true);
  });
});

describe('frameBudget', () => {
  const run = (b: ReturnType<typeof frameBudget>, dt: number, ms: number) => {
    let tripped = false;
    for (let t = 0; t < ms; t += dt) tripped ||= b.frame(dt);
    return tripped;
  };
  it('stays quiet at 60 fps', () => expect(run(frameBudget(), 1000 / 60, 20000)).toBe(false));
  it('stays quiet at exactly the 30 fps floor', () => expect(run(frameBudget(), 1000 / 30, 20000)).toBe(false));
  it('trips at 20 fps', () => expect(run(frameBudget(), 50, 20000)).toBe(true));
  it('ignores the start-up grace period', () => {
    const b = frameBudget();
    expect(run(b, 200, 1900)).toBe(false); // slow, but still compiling shaders
    expect(run(b, 1000 / 60, 12000)).toBe(false);
  });
  it('ignores a stall (hidden tab)', () => {
    const b = frameBudget();
    run(b, 1000 / 60, 2500);
    expect(b.frame(30000)).toBe(false);
    expect(run(b, 1000 / 60, 8000)).toBe(false);
  });
  it('does not trip on a hitch inside a fast window', () => {
    const b = frameBudget();
    run(b, 1000 / 60, 2500);
    expect(b.frame(400)).toBe(false);
    expect(run(b, 1000 / 60, 8000)).toBe(false);
  });
});
