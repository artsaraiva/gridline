// The sound engine, kept silent (#88): the synthesised cues of #84 and #85 were cut, their sampled replacements come one
// cue at a time into the CUE table below. What stays is the plumbing a cue plugs into: three buses (radio, chatter,
// combat) under a master with mute, chatter and combat ducking while a log line is on air, the repetition gates and the
// observability rule (audio-mix.ts, pure and unit-tested), the spatial chain that pans and fades a combat sound by where
// its source is drawn, and the loop bookkeeping that follows what the effects layer draws. Browsers keep audio locked
// until a user gesture, so the context is only made on the first press or key; until then everything is silent.
import type { CommanderView, SimEvent, Vec2 } from '../sim/types';
import { admit, admitImpact, admitShot, busGain, drawnLoops, type Loop, newGate, release, sourceDrawn, spatialise, TUNING } from './audio-mix';
import { camera, toScreen } from './renderer';

let ctx: AudioContext | null = null;
let master: GainNode;
let duck: GainNode; // chatter and combat pass through it; it drops while a radio line is on air
type Bus = keyof typeof TUNING.bus;
const bus = {} as Record<Bus, GainNode>;

function unlock() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
    duck = ctx.createGain();
    duck.connect(master);
    bus.radio = ctx.createGain();
    bus.radio.connect(master);
    bus.chatter = ctx.createGain();
    bus.chatter.connect(duck);
    bus.combat = ctx.createGain();
    bus.combat.connect(duck);
    applyMix();
  }
  void ctx.resume();
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, unlock, { capture: true });

const ready = () => !!ctx && ctx.state === 'running';

/** Applies `TUNING.bus` and `TUNING.mute` to the buses; call after changing them. */
export function applyMix() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(busGain(1, { ducked: false, muted: TUNING.mute }), t, 0.02);
  for (const k of Object.keys(bus) as Bus[]) bus[k].gain.setTargetAtTime(busGain(TUNING.bus[k], { ducked: false, muted: false }), t, 0.02);
}

let airUntil = 0;
/** Ducks chatter and combat from `t0` until the line is off air. */
function duckUntil(t0: number, until: number) {
  airUntil = Math.max(airUntil, until);
  duck.gain.cancelScheduledValues(t0);
  duck.gain.setTargetAtTime(busGain(1, { ducked: true, muted: false }), t0, 0.03);
  duck.gain.setTargetAtTime(1, airUntil, 0.15);
}

// --- radio ----------------------------------------------------------------------------------------------------------

/**
 * A log line on air for `seconds` from now: chatter and combat duck meanwhile. Returns the seconds on air, so the log
 * types for as long. Silent until a gesture unlocked audio. #88: no transmission sound plays; a sampled one goes here.
 */
export function transmit(seconds: number): number {
  if (!ready()) return seconds;
  const t0 = ctx!.currentTime;
  duckUntil(t0, t0 + seconds);
  return seconds;
}

// --- combat sounds -----------------------------------------------------------------------------------------------------

/** A playing combat sound: when it ends (Infinity for a loop), how to stop it, and for a loop, how to move it. */
interface Handle {
  until: number;
  stop(): void;
  at?(p: Vec2): void;
}

/** A spatial chain into the combat bus: `input` is panned by screen x and faded and low-passed by distance; `at` moves it. */
function placed(from: Vec2) {
  const input = ctx!.createGain();
  const lp = ctx!.createBiquadFilter();
  lp.type = 'lowpass';
  const pan = ctx!.createStereoPanner();
  input.connect(lp).connect(pan).connect(bus.combat);
  const at = (p: Vec2) => {
    const s = toScreen(p);
    const { pan: side, gain, cutoff } = spatialise(s.x, s.y, innerWidth, innerHeight, camera.zoom);
    const t = ctx!.currentTime;
    pan.pan.setTargetAtTime(side, t, 0.05);
    lp.frequency.setTargetAtTime(cutoff, t, 0.05);
    input.gain.setTargetAtTime(gain, t, 0.05);
  };
  at(from);
  return { input, at, release: () => setTimeout(() => input.disconnect(), 500) };
}

// --- cues --------------------------------------------------------------------------------------------------------
// #88: every cue is silent. Each one takes where its source is drawn and returns a Handle; a one-shot ends when its
// sound does, a loop lives until the frame stops drawing its source. A sampled cue replaces one entry: start the sample
// into `placed(at).input` and it is panned, faded, gated and ducked like any other.

const silentOneShot = (at: Vec2): Handle => {
  const out = placed(at);
  return { until: ctx!.currentTime, stop: out.release };
};
const silentLoop = (at: Vec2): Handle => {
  const out = placed(at);
  return { until: Infinity, at: out.at, stop: out.release };
};

const CUE: Record<'shot' | 'impact' | Loop['kind'], (at: Vec2) => Handle> = {
  shot: silentOneShot, // a burst of distant small-arms fire from a drawn shooter
  impact: silentOneShot, // an explosion on a drawn impact
  shell: silentLoop, // a shell's whistle while it is drawn in flight
  uav: silentLoop, // the Scan UAV while it is drawn on station
  crate: silentLoop, // the parachute while the crate is drawn falling
};

let gate = newGate();
const sounds = new Map<string, Handle>();
let serial = 0;

/** Books `id` with the concurrent cap, stopping what it evicts and forgetting what has ended. */
function play(id: string, handle: Handle) {
  const now = ctx!.currentTime;
  for (const old of admit(gate, id, now, handle.until)) {
    sounds.get(old)?.stop();
    sounds.delete(old);
  }
  for (const [key, h] of sounds) if (h.until <= now) sounds.delete(key);
  sounds.set(id, handle);
}

/** The combat sounds `events` call for, for sources drawn in `view`: a burst per Squad per window, an explosion per spaced impact. */
export function soundEvents(events: SimEvent[], view: CommanderView) {
  if (!ready()) return;
  const now = ctx!.currentTime;
  for (const e of events) {
    if (!sourceDrawn(view, e)) continue;
    if (e.kind === 'shot' || e.kind === 'suppressive') {
      const shooter = view.friendlies.find((s) => s.id === e.from);
      // ponytail: drawn Contacts coalesce as one group; the view carries no enemy Squad id to split them by.
      const squad = shooter ? `squad:${shooter.squad}` : 'contacts';
      if (!admitShot(gate, squad, now)) continue;
      const at = shooter ?? view.contacts.find((s) => s.id === e.from)!;
      play(`shot:${serial++}`, CUE.shot(at));
    } else if (e.kind === 'impact' && admitImpact(gate, now)) {
      play(`impact:${serial++}`, CUE.impact(e));
    }
  }
}

/** Once a frame: the looping cues follow what `view` draws (the UAV, the shells in flight, the falling crate). */
export function soundFrame(view: CommanderView, hq: Vec2, seconds: number) {
  if (!ready()) return;
  const drawn = drawnLoops(view, hq, seconds);
  const keys = new Set(drawn.map((l) => l.key));
  for (const [key, h] of sounds) {
    if (h.until !== Infinity || keys.has(key)) continue;
    h.stop();
    sounds.delete(key);
    release(gate, key);
  }
  for (const l of drawn) {
    const h = sounds.get(l.key);
    if (h) h.at!(l);
    else play(l.key, CUE[l.kind](l));
  }
}

/** Stops every combat sound and forgets the gates (a scenario replay, a new match). */
export function silence() {
  for (const h of sounds.values()) h.stop();
  sounds.clear();
  gate = newGate();
}
