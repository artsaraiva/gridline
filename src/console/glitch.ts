// VHS static bursts: when one may start and how strong it is now. Times are ms (performance.now()).
// Bursts never stack: one may start only 4 s after the last, and each has decayed to 0 long before that.
const GAP_MS = 4000;
const DECAY_PER_MS = 2.2 / 1000; // a full-strength burst is gone in ~0.45 s
const IDLE_EVERY_MS = 12_000; // mean wait for an idle burst, on top of the gap

export function glitchScheduler(random: () => number) {
  let last = -Infinity;
  let peak = 0;
  const burst = (now: number, k: number) => {
    if (now - last < GAP_MS) return false;
    last = now;
    peak = k;
    return true;
  };
  return {
    /** Starts a burst of strength `k` (0..1) unless one started less than 4 s ago. */
    burst,
    /** Call once a frame (`dt` ms since the last): now and then starts an idle burst. True when one started. */
    frame: (now: number, dt: number) => random() < dt / IDLE_EVERY_MS && burst(now, 0.35 + random() * 0.4),
    /** Burst strength at `now`, decaying linearly from its peak to 0. */
    level: (now: number) => Math.max(0, peak - (now - last) * DECAY_PER_MS),
  };
}
