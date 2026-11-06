// The pure side of the sound engine (#84): the mixer's numbers and the rules audio.ts applies before it touches Web
// Audio. Nothing here needs a browser, so all of it is unit-tested; audio.ts (the Web Audio graph) is judged by ear.
import type { CommanderView, SimEvent, Vec2 } from '../sim/types';
import { scanUav, shellInFlight } from './sprites';

/** Every tuning knob in one place; the audition page's sliders mutate it live. */
export const TUNING = {
  /** Chatter and combat drop this much while a radio line is on air. */
  duckDb: 6,
  /** Seconds between two Chatter transmissions, [min, max], at idle and while a friendly Squad is taking fire. */
  chatterIdle: [8, 25] as [number, number],
  chatterCombat: [3, 8] as [number, number],
  /** Shots from one Squad make one burst per window. */
  coalesceSeconds: 0.5,
  /** One-shot combat sounds (bursts, explosions) playing at once; the newest wins. Loops sit outside the cap. */
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

/** Books combat sound `id` playing from `now` to `until` and returns the one-shots evicted to keep within the cap (oldest first). */
export function admit(g: Gate, id: string, now: number, until: number): string[] {
  g.live = g.live.filter((s) => s.until > now);
  const evicted: string[] = [];
  // ponytail: loops (until Infinity) neither count nor get evicted; an evicted loop that is still drawn would only
  // restart next frame with its fade-in. Only the one-shots race for the cap.
  if (until !== Infinity) {
    const oneShots = g.live.filter((s) => s.until !== Infinity);
    for (const s of oneShots.slice(0, Math.max(0, oneShots.length + 1 - TUNING.maxConcurrent))) evicted.push(s.id);
    g.live = g.live.filter((s) => !evicted.includes(s.id));
  }
  g.live.push({ id, at: now, until });
  return evicted;
}

// The observability rule: a combat sound plays if and only if its source is drawn on the map at that moment. The
// Simulation's fog filter already drops unseen enemy shooters; these say what the layers would draw from the view.

/**
 * True when combat event `e` has a drawn source: a shot's shooter is a friendly or a drawn Contact (tracers.ts draws
 * nothing otherwise); an impact always, since impacts.ts draws every impact event the Console receives.
 */
export function sourceDrawn(view: CommanderView, e: SimEvent): boolean {
  if (e.kind === 'shot' || e.kind === 'suppressive') return view.friendlies.some((s) => s.id === e.from) || view.contacts.some((s) => s.id === e.from);
  return e.kind === 'impact';
}

/** A looping combat sound tied to something drawn: the key names its source, (x, y) is where it is this frame. */
export interface Loop {
  key: string;
  kind: 'uav' | 'crate' | 'shell';
  x: number;
  y: number;
}

/** The loops the effects layer draws from `view` at `seconds`: the UAV in orbit, the crate in the air, every shell in flight from `hq`. */
export function drawnLoops(view: CommanderView, hq: Vec2, seconds: number): Loop[] {
  const out: Loop[] = [];
  for (const e of view.effects ?? []) {
    if (e.asset === 'scan') {
      const u = scanUav(e, e.radius, seconds);
      out.push({ key: `uav:${e.x}:${e.y}`, kind: 'uav', x: u.x, y: u.y });
    }
    if (e.landsIn !== undefined && e.fall && e.landsIn > 0) out.push({ key: `crate:${e.x}:${e.y}`, kind: 'crate', x: e.x, y: e.y });
    for (const s of e.shells ?? []) {
      const p = shellInFlight(hq, s, s.flight);
      out.push({ key: `shell:${s.x}:${s.y}`, kind: 'shell', x: p.x, y: p.y });
    }
  }
  return out;
}

/** Combat, from visible information only: a friendly Squad is taking fire. */
export const inCombat = (view: CommanderView) => view.squads.some((q) => q.takingFire);

// Voice Lines (#83 generates `assets/voice/<id>.wav` for each): HQ speaks these and nothing else.
const POINT_NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'] as const;
export const VOICE_IDS = [
  'uav-inbound',
  'uav-on-station',
  'uav-has-contacts',
  'uav-off-station',
  'supplies-inbound',
  'supplies-on-the-ground',
  'fire-mission-shot',
  'splash',
  'artillery-incoming',
  'squad-wiped',
  ...POINT_NAMES.map((n) => `point-lost-${n}` as const),
] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

const VOICE: [RegExp, VoiceId][] = [
  [/^Scan UAV inbound$/, 'uav-inbound'],
  [/^UAV on station$/, 'uav-on-station'],
  [/^UAV eyes on \d+ hostile/, 'uav-has-contacts'],
  [/^UAV off station/, 'uav-off-station'],
  [/^Supply Drop inbound$/, 'supplies-inbound'],
  [/^Supply Drop landed$/, 'supplies-on-the-ground'],
  [/^Barrage inbound$/, 'fire-mission-shot'],
  [/^Splash$/, 'splash'],
  [/^Artillery incoming$/, 'artillery-incoming'],
  [/ wiped$/, 'squad-wiped'],
  ...POINT_NAMES.map((n): [RegExp, VoiceId] => [new RegExp(`^${n} lost$`, 'i'), `point-lost-${n}`]),
];

/** The Voice Line that speaks radio log line `text` (the typed line keeps its full text), or null for buzz plus text. */
export const voiceFor = (text: string): VoiceId | null => VOICE.find(([re]) => re.test(text))?.[1] ?? null;

// Spatial: combat sounds sit where their source is drawn. Radio, Voice Lines and Chatter come from the Console and never pan.
const PAN_WIDTH = 0.8; // full left/right is harsh on a tablet
const OFF_SCREEN_GAIN = 0.4;
const OFF_SCREEN_CUTOFF = 900; // Hz
const FULL_BAND = 20000;

/** Pan, gain and low-pass cutoff for a source at screen (sx, sy) in a `w` x `h` viewport at `zoom`. */
export function spatialise(sx: number, sy: number, w: number, h: number, zoom: number): { pan: number; gain: number; cutoff: number } {
  const pan = Math.max(-1, Math.min(1, (sx - w / 2) / (w / 2))) * PAN_WIDTH;
  const d = Math.hypot(sx - w / 2, sy - h / 2) / (h / 2); // 1 at the top or bottom edge
  const off = sx < 0 || sx > w || sy < 0 || sy > h;
  const near = Math.min(1, 0.4 + 0.15 * zoom); // the overview hears the battle from far away
  return { pan, gain: (near / (1 + d * d * 0.5)) * (off ? OFF_SCREEN_GAIN : 1), cutoff: off ? OFF_SCREEN_CUTOFF : FULL_BAND };
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
