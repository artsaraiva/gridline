// The sound engine, all synthesised with Web Audio except the Voice Lines (ADR 0003). #38: a transmission is a squelch
// click when the key opens, a static bed with a band-limited buzz that swells at syllable rate while the line is on
// air, a squelch tail when it closes, then a roger beep. #84: a Voice Line is the same transmission with the buzz
// replaced by the sample through a runtime radio band-limit; Chatter is a short quiet buzz transmission; the six combat
// sounds are small synths placed on the map; three buses (radio, chatter, combat) sit under a master with mute, and
// chatter and combat duck while a line is on air. The rules (what plays, when, how loud) are pure, in audio-mix.ts.
// Browsers keep audio locked until a user gesture, so the context is only made on the first press or key; until then
// everything is silent.
import type { CommanderView, SimEvent, Vec2 } from '../sim/types';
import { admit, admitImpact, admitShot, busGain, chatterGap, drawnLoops, inCombat, type Loop, newGate, sourceDrawn, spatialise, TUNING, type VoiceId, voiceFor } from './audio-mix';
import { camera, toScreen } from './renderer';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let master: GainNode;
let duck: GainNode; // chatter and combat pass through it; it drops while a radio line is on air
const bus = {} as Record<'radio' | 'chatter' | 'combat', GainNode>;

function unlock() {
  if (!ctx) {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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
    void loadVoices();
  }
  void ctx.resume();
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, unlock, { capture: true });

const ready = () => !!ctx && !!noise && ctx.state === 'running';

/** Applies `TUNING.bus` and `TUNING.mute` to the buses; call after changing them. */
export function applyMix() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(busGain(1, { ducked: false, muted: TUNING.mute }), t, 0.02);
  for (const k of ['radio', 'chatter', 'combat'] as const) bus[k].gain.setTargetAtTime(busGain(TUNING.bus[k], { ducked: false, muted: false }), t, 0.02);
}

let airUntil = 0;
/** Ducks chatter and combat from `t0` until the line is off air. */
function duckUntil(t0: number, until: number) {
  airUntil = Math.max(airUntil, until);
  duck.gain.cancelScheduledValues(t0);
  duck.gain.setTargetAtTime(busGain(1, { ducked: true, muted: false }), t0, 0.03);
  duck.gain.setTargetAtTime(1, airUntil, 0.15);
}

// --- transmissions -------------------------------------------------------------------------------------------------

type Voice = (t0: number, t1: number, out: GainNode) => void;

/** Band-limited noise into `out` from `at` for `len` seconds. */
function hiss(out: GainNode, at: number, len: number, hz: number, q: number, level: number, loop = false) {
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  src.loop = loop;
  src.loopStart = Math.random() * 0.5;
  const band = ctx!.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = hz;
  band.Q.value = q;
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + Math.min(0.01, len / 2));
  g.gain.setValueAtTime(level, at + len - Math.min(0.02, len / 2));
  g.gain.linearRampToValueAtTime(0, at + len);
  src.connect(band).connect(g).connect(out);
  src.start(at, src.loopStart);
  src.stop(at + len);
}

/** The #38 voice: a band-limited buzz (a voice-like saw, 300 Hz to 2.8 kHz) whose level swells and dips at syllable rate. */
const buzz: Voice = (t0, t1, out) => {
  const saw = ctx!.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = 110 + Math.random() * 40;
  const level = ctx!.createGain();
  level.gain.value = 0.035;
  const syllables = ctx!.createOscillator();
  syllables.frequency.value = 4.5 + Math.random() * 2.5;
  const depth = ctx!.createGain();
  depth.gain.value = 0.03;
  syllables.connect(depth).connect(level.gain);
  radioBand(saw).connect(level).connect(out);
  for (const o of [saw, syllables]) {
    o.start(t0);
    o.stop(t1);
  }
};

/** `src` through the radio band-limit (highpass 300 Hz, lowpass 2.8 kHz); returns the lowpass to connect on. */
function radioBand(src: AudioNode): AudioNode {
  const hp = ctx!.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 300;
  const lp = ctx!.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2800;
  src.connect(hp).connect(lp);
  return lp;
}

let clip: Float32Array<ArrayBuffer> | null = null;
/** A Voice Line's sample through the radio band-limit, a little drive and compression, so it sits in the same net as the buzz. */
const voiced = (sample: AudioBuffer): Voice => (t0, t1, out) => {
  const src = ctx!.createBufferSource();
  src.buffer = sample;
  const drive = ctx!.createWaveShaper();
  if (!clip) {
    clip = new Float32Array(1024);
    for (let i = 0; i < clip.length; i++) clip[i] = Math.tanh(((i / 511.5 - 1) * 2.5));
  }
  drive.curve = clip;
  const comp = ctx!.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;
  const g = ctx!.createGain();
  g.gain.value = 0.7;
  radioBand(src).connect(drive).connect(comp).connect(g).connect(out);
  src.start(t0);
  src.stop(t1);
};

/** One transmission on `to` from now: click, bed and `voice` for `seconds`, tail, roger beep (unless `plain`). Returns when it is off air. */
function transmission(to: GainNode, seconds: number, level: number, voice: Voice, plain = false): number {
  const t0 = ctx!.currentTime;
  const t1 = t0 + 0.03 + seconds;
  const out = ctx!.createGain();
  out.gain.value = level;
  out.connect(to);
  hiss(out, t0, 0.02, 2400, 0.8, 0.5); // squelch click: the key opens
  hiss(out, t0 + 0.02, seconds + 0.02, 1800, 0.6, 0.07, true); // static bed
  hiss(out, t1, 0.06, 1500, 0.6, 0.35); // squelch tail: the key closes
  voice(t0 + 0.03, t1, out);
  if (plain) return t1 + 0.06;
  const beep = ctx!.createOscillator();
  beep.frequency.value = 1250;
  const bg = ctx!.createGain();
  const b0 = t1 + 0.09;
  bg.gain.setValueAtTime(0, b0);
  bg.gain.linearRampToValueAtTime(0.12, b0 + 0.01);
  bg.gain.setValueAtTime(0.12, b0 + 0.07);
  bg.gain.linearRampToValueAtTime(0, b0 + 0.09);
  beep.connect(bg).connect(out);
  beep.start(b0);
  beep.stop(b0 + 0.1);
  return b0 + 0.1;
}

/** A line on the radio bus, ducking the rest while it is on air. Returns `seconds`. */
function radio(seconds: number, voice: Voice): number {
  const t0 = ctx!.currentTime;
  duckUntil(t0, transmission(bus.radio, seconds, 0.5, voice));
  return seconds;
}

/**
 * Plays one radio transmission of `seconds` from now, or, when `text` is a radio log line a Voice Line speaks, that
 * Voice Line (ADR 0003) for the sample's length instead. Returns the seconds on air, so the log types for as long.
 * Silent until a gesture unlocked audio.
 */
export function transmit(seconds: number, text?: string): number {
  if (!ready()) return seconds;
  const id = text === undefined ? null : voiceFor(text);
  return id ? speak(id, seconds) : radio(seconds, buzz);
}

/** Plays Voice Line `id` as a transmission and returns its length in seconds; the buzz for `fallbackSeconds` while its file is missing or still loading. */
export function speak(id: VoiceId, fallbackSeconds = 1.2): number {
  if (!ready()) return fallbackSeconds;
  const sample = voices.get(id);
  if (!sample) {
    if (!VOICE_URLS[voicePath(id)] && !warned.has(id)) {
      warned.add(id);
      console.warn(`Voice Line ${id}: no assets/voice/${id}.wav (#83); it plays as buzz.`);
    }
    return radio(fallbackSeconds, buzz);
  }
  return radio(sample.duration, voiced(sample));
}

// Voice Line files, lazily: a missing one logs a warning once and plays as buzz. Vite bundles the ones that exist.
const VOICE_URLS = import.meta.glob('../../assets/voice/*.wav', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
const voicePath = (id: VoiceId) => `../../assets/voice/${id}.wav`;
const voices = new Map<VoiceId, AudioBuffer>();
const warned = new Set<VoiceId>();
let loading: Promise<void> | null = null;

/** Decodes every Voice Line file there is; needs the unlocked context. Resolves once they are all ready (or warned about). */
export function loadVoices(): Promise<void> {
  if (!ctx) return Promise.resolve();
  loading ??= Promise.all(
    Object.entries(VOICE_URLS).map(async ([path, load]) => {
      const id = path.slice(path.lastIndexOf('/') + 1, -4) as VoiceId;
      try {
        const bytes = await (await fetch(await load())).arrayBuffer();
        voices.set(id, await ctx!.decodeAudioData(bytes));
      } catch (err) {
        console.warn(`Voice Line ${id} failed to load; it plays as buzz.`, err);
      }
    }),
  ).then(() => undefined);
  return loading;
}

// --- Chatter ---------------------------------------------------------------------------------------------------------

let nextChatter = 0;
let wasCombat = false;

/** Call once a frame with `inCombat(view)`: a short quiet buzz transmission on the chatter bus every Chatter gap. */
export function chatterTick(combat: boolean) {
  if (!ready()) return;
  const now = ctx!.currentTime;
  if (combat !== wasCombat || nextChatter === 0) {
    wasCombat = combat;
    nextChatter = Math.min(nextChatter || Infinity, now + chatterGap(combat));
  }
  if (now < nextChatter) return;
  transmission(bus.chatter, 0.3 + Math.random() * 0.9, 0.25, buzz, true);
  nextChatter = now + chatterGap(combat);
}

// --- combat sounds -----------------------------------------------------------------------------------------------------

/** A playing combat sound: when it ends (Infinity for a loop), how to stop it, and for a loop, how to move it. */
interface Handle {
  until: number;
  stop(): void;
  at?(x: number, y: number): void;
}

/** A spatial chain into the combat bus: `input` is panned by screen x and faded and low-passed by distance; `at` moves it. */
function placed(x: number, y: number) {
  const input = ctx!.createGain();
  const lp = ctx!.createBiquadFilter();
  lp.type = 'lowpass';
  const pan = ctx!.createStereoPanner();
  input.connect(lp).connect(pan).connect(bus.combat);
  const at = (px: number, py: number) => {
    const s = toScreen({ x: px, y: py });
    const { pan: p, gain, cutoff } = spatialise(s.x, s.y, innerWidth, innerHeight, camera.zoom);
    const t = ctx!.currentTime;
    pan.pan.setTargetAtTime(p, t, 0.05);
    lp.frequency.setTargetAtTime(cutoff, t, 0.05);
    input.gain.setTargetAtTime(gain, t, 0.05);
  };
  at(x, y);
  return { input, at, release: () => setTimeout(() => input.disconnect(), 500) };
}

/** Exponential decay of `g` from `peak` at `at` to silence by `at + len`. */
function decay(g: GainNode, at: number, peak: number, len: number) {
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + len);
}

/** A burst of distant small-arms fire: a few noise hits with a low thump each, pitch, count and spacing randomised. */
function shotBurst(x: number, y: number): Handle {
  const t0 = ctx!.currentTime;
  const out = placed(x, y);
  const n = 3 + Math.floor(Math.random() * 4);
  const gap = 0.07 + Math.random() * 0.05;
  const hz = 500 + Math.random() * 700;
  for (let i = 0; i < n; i++) {
    const at = t0 + i * gap;
    const src = ctx!.createBufferSource();
    src.buffer = noise;
    const band = ctx!.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = hz * (0.9 + Math.random() * 0.2);
    band.Q.value = 1.2;
    const g = ctx!.createGain();
    decay(g, at, 0.6, 0.05 + Math.random() * 0.03);
    src.connect(band).connect(g).connect(out.input);
    src.start(at, Math.random() * 0.5);
    src.stop(at + 0.1);
    const thump = ctx!.createOscillator();
    thump.frequency.setValueAtTime(110, at);
    thump.frequency.exponentialRampToValueAtTime(50, at + 0.05);
    const tg = ctx!.createGain();
    decay(tg, at, 0.25, 0.06);
    thump.connect(tg).connect(out.input);
    thump.start(at);
    thump.stop(at + 0.08);
  }
  const until = t0 + n * gap + 0.1;
  return { until, stop: out.release };
}

/** An explosion: a noise blast whose low-pass sweeps down over a randomised length, under a sub thump. */
function explosion(x: number, y: number): Handle {
  const t0 = ctx!.currentTime;
  const out = placed(x, y);
  const len = 0.8 + Math.random() * 0.6;
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  const lp = ctx!.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(500 + Math.random() * 300, t0);
  lp.frequency.exponentialRampToValueAtTime(60, t0 + len);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(1, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
  src.connect(lp).connect(g).connect(out.input);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + len);
  const sub = ctx!.createOscillator();
  sub.frequency.setValueAtTime(55 + Math.random() * 15, t0);
  sub.frequency.exponentialRampToValueAtTime(28, t0 + 0.4);
  const sg = ctx!.createGain();
  decay(sg, t0, 0.5, 0.45);
  sub.connect(sg).connect(out.input);
  sub.start(t0);
  sub.stop(t0 + 0.5);
  return { until: t0 + len, stop: out.release };
}

/** Fades `g` out and stops `sources`, for a loop's `stop`. */
function fadeOut(g: GainNode, sources: AudioScheduledSourceNode[], release: () => void) {
  return () => {
    const t = ctx!.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, 0.05);
    for (const s of sources) s.stop(t + 0.3);
    release();
  };
}

/** A shell's whistle while it is drawn in flight: a sine that falls in pitch with a light vibrato, start pitch randomised. */
function shellWhistle(x: number, y: number): Handle {
  const t0 = ctx!.currentTime;
  const out = placed(x, y);
  const osc = ctx!.createOscillator();
  const start = 1800 + Math.random() * 800;
  osc.frequency.setValueAtTime(start, t0);
  osc.frequency.exponentialRampToValueAtTime(start * 0.45, t0 + 4);
  const vib = ctx!.createOscillator();
  vib.frequency.value = 5 + Math.random() * 3;
  const vd = ctx!.createGain();
  vd.gain.value = 25;
  vib.connect(vd).connect(osc.frequency);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.08, t0 + 0.4);
  osc.connect(g).connect(out.input);
  osc.start(t0);
  vib.start(t0);
  return { until: Infinity, at: out.at, stop: fadeOut(g, [osc, vib], out.release) };
}

/** The Scan UAV's hum while it is drawn on station: two detuned saws through a low-pass, with a slow throb. */
function uavHum(x: number, y: number): Handle {
  const t0 = ctx!.currentTime;
  const out = placed(x, y);
  const base = 88 + Math.random() * 16;
  const lp = ctx!.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300 + Math.random() * 120;
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.07, t0 + 1);
  const throb = ctx!.createOscillator();
  throb.frequency.value = 0.3 + Math.random() * 0.3;
  const td = ctx!.createGain();
  td.gain.value = 0.02;
  throb.connect(td).connect(g.gain);
  const saws = [base, base * 1.02].map((hz) => {
    const o = ctx!.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz;
    o.connect(lp);
    o.start(t0);
    return o;
  });
  lp.connect(g).connect(out.input);
  throb.start(t0);
  return { until: Infinity, at: out.at, stop: fadeOut(g, [...saws, throb], out.release) };
}

/** The parachute's flutter while the crate is drawn falling: band-passed noise chopped at a randomised flap rate. */
function parachuteFlutter(x: number, y: number): Handle {
  const t0 = ctx!.currentTime;
  const out = placed(x, y);
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const band = ctx!.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 700 + Math.random() * 700;
  band.Q.value = 0.7;
  const flap = ctx!.createGain();
  flap.gain.value = 0.06;
  const lfo = ctx!.createOscillator();
  lfo.frequency.value = 7 + Math.random() * 4;
  const ld = ctx!.createGain();
  ld.gain.value = 0.05;
  lfo.connect(ld).connect(flap.gain);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(1, t0 + 0.5);
  src.connect(band).connect(flap).connect(g).connect(out.input);
  src.start(t0, Math.random() * 0.5);
  lfo.start(t0);
  return { until: Infinity, at: out.at, stop: fadeOut(g, [src, lfo], out.release) };
}

const LOOP: Record<Loop['kind'], (x: number, y: number) => Handle> = { shell: shellWhistle, uav: uavHum, crate: parachuteFlutter };

const gate = newGate();
const sounds = new Map<string, Handle>();
let serial = 0;

/** Books `id` with the concurrent cap, stopping what it evicts. */
function play(id: string, handle: Handle) {
  for (const old of admit(gate, id, ctx!.currentTime, handle.until)) sounds.get(old)?.stop();
  sounds.set(id, handle);
  for (const key of sounds.keys()) if (!gate.live.some((s) => s.id === key)) sounds.delete(key);
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
      play(`shot:${serial++}`, shotBurst(at.x, at.y));
    } else if (e.kind === 'impact' && admitImpact(gate, now)) {
      play(`impact:${serial++}`, explosion(e.x, e.y));
    }
  }
}

/** Once a frame: the looping sounds follow what `view` draws (UAV hum, shell whistles, parachute flutter), and Chatter ticks. */
export function soundFrame(view: CommanderView, hq: Vec2, seconds: number) {
  if (!ready()) return;
  chatterTick(inCombat(view));
  const drawn = drawnLoops(view, hq, seconds);
  const keys = new Set(drawn.map((l) => l.key));
  for (const [key, h] of sounds) {
    if (h.until !== Infinity || keys.has(key)) continue;
    h.stop();
    sounds.delete(key);
    gate.live = gate.live.filter((s) => s.id !== key);
  }
  for (const l of drawn) {
    const h = sounds.get(l.key);
    if (h) h.at!(l.x, l.y);
    else play(l.key, LOOP[l.kind](l.x, l.y));
  }
}

/** Stops every combat sound and forgets the gates and the Chatter clock (a scenario replay, a new match). */
export function silence() {
  for (const h of sounds.values()) h.stop();
  sounds.clear();
  gate.live = [];
  gate.bursts.clear();
  gate.lastImpact = -Infinity;
  nextChatter = 0;
}
