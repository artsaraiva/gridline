// DEV-only audition page (#84): the real Kaltenbach bake and the real Console layers, driven by the scripted scenarios
// in audio-review-timeline.ts instead of a Simulation, so the mix is judged by ear first. The sound engine and the mixer
// panel are main.ts's (#85), here as on a live Match; this page adds the repetition knobs. Only reachable
// through dev-audio-review.html.
import { loadBakedMap } from '../../maps/load';
import { DEFAULT_TUNE } from '../../sim/tune';
import { silence } from '../audio';
import { TUNING } from '../audio-mix';
import { resetRadioLog } from '../chrome/radio-log';
import { eventsBetween, SCENARIOS, type ScenarioId, viewAt } from './audio-review-timeline';
import { $, type ScriptedTimeline, startScriptedHost } from './scripted-host';
import './review-controls.css';

const CLOSE_AT = { x: -45, y: 12, zoom: 6 }; // between the Squads and the Contacts, so shots pan left and right

/** A native range input bound to a number: `get` reads it, `set` writes it. */
function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit = '') {
  const row = document.createElement('label');
  row.className = 'row';
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" /><output></output>`;
  const input = row.querySelector('input')!;
  const out = row.querySelector('output')!;
  const show = () => (out.textContent = `${get()}${unit}`);
  input.value = String(get());
  input.oninput = () => {
    set(Number(input.value));
    show();
  };
  show();
  return row;
}

/** Starts the audition page. */
export async function startAudioReview() {
  if (!import.meta.env.DEV) {
    throw new Error('Audio review page is DEV-only');
  }

  $('setup').hidden = true;
  $('end').hidden = true;

  const controls = document.createElement('div');
  controls.id = 'audio-review-controls';
  controls.className = 'review-controls';
  controls.innerHTML = `
    <div class="eyebrow">DEV review / #84</div>
    <h2>Audio review</h2>
    <ol class="chapters">${SCENARIOS.map((s) => `<li><button type="button" data-id="${s.id}">${s.title}</button></li>`).join('')}</ol>
    <div class="row">
      <button id="ar-play" type="button">Pause</button>
      <input id="ar-scrub" type="range" min="0" max="1" step="0.1" value="0" />
      <output id="ar-time">0.0 s</output>
    </div>
    <div class="row">
      <button id="ar-overview" type="button">Overview (1)</button>
      <button id="ar-close" type="button">Close zoom (2)</button>
    </div>
    <div id="ar-tuning"></div>
    <small>Tap once to unlock audio. Scripted timelines, no Simulation. Levels and Mute are the speaker button in the radio head (M mutes). Every cue is silent until its sample lands (#88).</small>
  `;
  document.body.appendChild(controls);
  const scrub = $('ar-scrub') as HTMLInputElement;

  const tuning = $('ar-tuning');
  tuning.append(
    slider('Coalesce window', 0.1, 2, 0.1, () => TUNING.coalesceSeconds, (v) => (TUNING.coalesceSeconds = v), ' s'),
    slider('Concurrent cap', 1, 12, 1, () => TUNING.maxConcurrent, (v) => (TUNING.maxConcurrent = v)),
    slider('Impact spacing', 0, 1, 0.05, () => TUNING.impactGapSeconds, (v) => (TUNING.impactGapSeconds = v), ' s'),
    slider('Duck', 0, 20, 1, () => TUNING.duckDb, (v) => (TUNING.duckDb = v), ' dB'),
  );

  // The scripted host over the chosen scenario. A jump silences the engine (main.ts hooks it on the host's frames and
  // events); the start of a scenario (a chapter button, the loop) also clears the log.
  let scenario: ScenarioId = SCENARIOS[0]!.id;
  const map = await loadBakedMap(`${import.meta.env.BASE_URL}maps/kaltenbach`, DEFAULT_TUNE.cellM);
  const timeline: ScriptedTimeline = {
    length: SCENARIOS[0]!.length,
    viewAt: (t) => viewAt(scenario, t),
    eventsBetween: (t0, t1) => eventsBetween(scenario, t0, t1),
    onJump: (to) => {
      silence();
      if (to === 0) resetRadioLog();
    },
  };
  const { jump } = await startScriptedHost(map, 'ar', timeline, CLOSE_AT);

  const buttons = controls.querySelectorAll<HTMLButtonElement>('.chapters button');
  const select = (id: ScenarioId) => {
    scenario = id;
    timeline.length = SCENARIOS.find((s) => s.id === id)!.length;
    scrub.max = String(timeline.length);
    for (const b of buttons) b.classList.toggle('on', b.dataset.id === id);
    jump(0);
  };
  for (const b of buttons) b.onclick = () => select(b.dataset.id as ScenarioId);
  select(scenario);
  document.body.dataset.reviewReady = 'true';
}

void startAudioReview();
