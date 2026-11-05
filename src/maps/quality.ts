// Which level of the bake's mip chain the play texture starts at, and when a slow frame rate says to start lower (#45).
// `images.play` is largest first, halving: index 0 is 8192 px, index 1 is the 4096 px fallback.

const FALLBACK_PX = 4096;

/** Index into the bake's levels to start at: the first one the GPU can hold, and never above the fallback once `slow`. */
export function playStart(levels: number, maxTextureSize: number, slow: boolean): number {
  let start = slow ? Math.min(1, levels - 1) : 0;
  while (start < levels - 1 && 2 ** (levels - 1 - start) > maxTextureSize) start++;
  return start;
}

/** True while the bake is at or under the fallback size, so there is nothing lower to drop to. */
export const atFallback = (levels: number, start: number) => 2 ** (levels - 1 - start) <= FALLBACK_PX;

/**
 * Trips once the mean frame time over a whole `windowMs` (after `graceMs` of shader compile and texture upload) is
 * slower than `floorFps`. Frames longer than `stallMs` are a hidden tab or a stall, not load, and are skipped.
 */
export function frameBudget(o: { floorFps?: number; windowMs?: number; graceMs?: number; stallMs?: number } = {}) {
  const { floorFps = 30, windowMs = 4000, graceMs = 2000, stallMs = 1000 } = o;
  let age = 0;
  let sum = 0;
  let frames = 0;
  return {
    /** Feed every frame's duration in ms; returns true when the budget was missed (and keeps returning it each missed window). */
    frame(dtMs: number): boolean {
      if (dtMs > stallMs) return false;
      age += dtMs;
      if (age < graceMs) return false;
      sum += dtMs;
      frames++;
      if (sum < windowMs) return false;
      const slow = sum / frames > 1000 / floorFps + 0.01; // epsilon: exactly 30 fps is on the floor, not under it
      sum = frames = 0;
      return slow;
    },
  };
}
