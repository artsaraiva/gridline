// The pure side of the sound engine (#84): the mixer's numbers and the rules audio.ts applies before it touches Web
// Audio. Nothing here needs a browser, so all of it is unit-tested; audio.ts (the Web Audio graph) is judged by ear.

/** Every tuning knob in one place; the audition page's sliders mutate it live. */
export const TUNING = {
  /** Chatter and combat drop this much while a radio line is on air. */
  duckDb: 6,
  /** Seconds between two Chatter transmissions, [min, max], at idle and while a friendly Squad is taking fire. */
  chatterIdle: [8, 25] as [number, number],
  chatterCombat: [3, 8] as [number, number],
  /** Shots from one Squad make one burst per window. */
  coalesceSeconds: 0.5,
  /** Combat sounds playing at once; the newest wins. */
  maxConcurrent: 6,
  /** Two explosions never land closer than this. */
  impactGapSeconds: 0.2,
  /** Bus levels 0..1 (the spec's defaults: Radio 80%, Combat 60%, Chatter 40%). */
  bus: { radio: 0.8, chatter: 0.4, combat: 0.6 },
  mute: false,
};

export const dbToGain = (db: number) => 10 ** (db / 20);

/** Repetition control state: when each Squad last fired a burst, when the last explosion landed, what is playing. */
export interface Gate {
  bursts: Map<string, number>;
  lastImpact: number;
  live: { id: string; at: number; until: number }[];
}
export const newGate = (): Gate => ({ bursts: new Map(), lastImpact: -Infinity, live: [] });

/** True when `squad`'s shot at `now` starts a burst: its last one was a coalesce window or more ago. */
export function admitShot(g: Gate, squad: string, now: number): boolean {
  const last = g.bursts.get(squad);
  if (last !== undefined && now - last < TUNING.coalesceSeconds) return false;
  g.bursts.set(squad, now);
  return true;
}

/** True when an explosion may land at `now`: the last one was an impact gap or more ago. */
export function admitImpact(g: Gate, now: number): boolean {
  if (now - g.lastImpact < TUNING.impactGapSeconds) return false;
  g.lastImpact = now;
  return true;
}

/** Books combat sound `id` playing from `now` to `until` and returns the ids evicted to keep within the cap (oldest first). */
export function admit(g: Gate, id: string, now: number, until: number): string[] {
  g.live = g.live.filter((s) => s.until > now);
  const evicted: string[] = [];
  while (g.live.length >= TUNING.maxConcurrent) evicted.push(g.live.shift()!.id);
  g.live.push({ id, at: now, until });
  return evicted;
}

/** Seconds until the next Chatter, drawn from the idle or combat gap with `random` (0 <= r < 1). */
export function chatterGap(combat: boolean, random: () => number = Math.random): number {
  const [lo, hi] = combat ? TUNING.chatterCombat : TUNING.chatterIdle;
  return lo + (hi - lo) * random();
}

/** Linear gain of a bus at `level` (0..1): zero when the master is muted, `TUNING.duckDb` lower while ducked. */
export function busGain(level: number, state: { ducked: boolean; muted: boolean }): number {
  if (state.muted) return 0;
  return level * (state.ducked ? dbToGain(-TUNING.duckDb) : 1);
}
