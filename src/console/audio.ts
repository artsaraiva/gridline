// Radio sound, all synthesised with Web Audio (no audio files): a squelch click when the key opens, a static bed with a
// band-limited buzz that swells at syllable rate while the line is on air, a squelch tail when it closes, then a roger beep.
// Browsers keep audio locked until a user gesture, so the context is only made on the first press or key; until then
// transmissions are silent.
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function unlock() {
  if (!ctx) {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  void ctx.resume();
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, unlock, { capture: true });

/** Plays one transmission of `seconds` from now: click, bed and buzz for `seconds`, tail, roger beep. Silent until a gesture unlocked audio. */
export function transmit(seconds: number) {
  if (!ctx || !noise || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const t1 = t0 + 0.03 + seconds;
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(ctx.destination);

  const hiss = (at: number, len: number, hz: number, q: number, level: number, loop = false) => {
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
  };
  hiss(t0, 0.02, 2400, 0.8, 0.5); // squelch click: the key opens
  hiss(t0 + 0.02, seconds + 0.02, 1800, 0.6, 0.07, true); // static bed
  hiss(t1, 0.06, 1500, 0.6, 0.35); // squelch tail: the key closes

  // band-limited buzz (a voice-like saw, 300 Hz to 2.8 kHz) whose level swells and dips at syllable rate
  const buzz = ctx.createOscillator();
  buzz.type = 'sawtooth';
  buzz.frequency.value = 110 + Math.random() * 40;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 300;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2800;
  const level = ctx.createGain();
  level.gain.value = 0.035;
  const syllables = ctx.createOscillator();
  syllables.frequency.value = 4.5 + Math.random() * 2.5;
  const depth = ctx.createGain();
  depth.gain.value = 0.03;
  syllables.connect(depth).connect(level.gain);
  buzz.connect(hp).connect(lp).connect(level).connect(out);
  for (const o of [buzz, syllables]) {
    o.start(t0 + 0.03);
    o.stop(t1);
  }

  // roger beep
  const beep = ctx.createOscillator();
  beep.frequency.value = 1250;
  const bg = ctx.createGain();
  const b0 = t1 + 0.09;
  bg.gain.setValueAtTime(0, b0);
  bg.gain.linearRampToValueAtTime(0.12, b0 + 0.01);
  bg.gain.setValueAtTime(0.12, b0 + 0.07);
  bg.gain.linearRampToValueAtTime(0, b0 + 0.09);
  beep.connect(bg).connect(out);
  beep.start(b0);
  beep.stop(b0 + 0.1);
}
