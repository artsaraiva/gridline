// DEV-only Commander look review scene (#69): the real Kaltenbach bake and the real Console layers and post chain, driven
// by the scripted timeline in commander-review-timeline.ts instead of a Simulation, so the readability treatments (#70,
// #71) are judged on every Squad Leader state. This file is only reachable through dev-commander-review.html.
import type { SimHost } from '../../host/host';
import { loadBakedMap } from '../../maps/load';
import { DEFAULT_TUNE } from '../../sim/tune';
import { drawMap, fitView } from '../layers/map';
import { camera } from '../renderer';
import { session } from '../session';
import { CHAPTERS, CLOSE_AT, eventsBetween, LENGTH, viewAt } from './commander-review-timeline';
import './commander-review.css';

function $(id: string) {
  return document.getElementById(id)!;
}

/** Starts the review scene. */
export async function startCommanderReview() {
  if (!import.meta.env.DEV) {
    throw new Error('Commander review scene is DEV-only');
  }

  $('setup').hidden = true;
  $('end').hidden = true;

  const controls = document.createElement('div');
  controls.id = 'commander-review-controls';
  controls.innerHTML = `
    <div class="eyebrow">DEV review / #69</div>
    <h2>Commander look review</h2>
    <div class="row">
      <button id="cr-play" type="button">Pause</button>
      <input id="cr-scrub" type="range" min="0" max="${LENGTH}" step="0.1" value="0" />
      <output id="cr-time">0.0 s</output>
    </div>
    <div class="row">
      <button id="cr-overview" type="button">Overview (1)</button>
      <button id="cr-close" type="button">Close zoom (2)</button>
    </div>
    <ol class="chapters">${CHAPTERS.map((c) => `<li><button type="button" data-at="${c.at}"><span>${c.at}s</span>${c.title}</button></li>`).join('')}</ol>
    <small>Scripted timeline, no Simulation. Select a Squad on its rail tile or by tapping a chevron. Space plays and pauses.</small>
  `;
  document.body.appendChild(controls);
  const play = $('cr-play') as HTMLButtonElement;
  const scrub = $('cr-scrub') as HTMLInputElement;
  const time = $('cr-time');

  // The scripted host: `sample` advances the clock while playing; `takeEvents` hands over what the clock crossed since the
  // last frame, and nothing on a scrub jump.
  let t = 0;
  let playing = true;
  let lastNow: number | null = null;
  let eventsFrom = 0;
  const map = await loadBakedMap(`${import.meta.env.BASE_URL}maps/kaltenbach`, DEFAULT_TUNE.cellM);
  const host: SimHost = {
    map,
    send() {},
    record: () => null,
    stop() {},
    sample(now) {
      if (playing && lastNow !== null) {
        t += (now - lastNow) / 1000;
        if (t >= LENGTH) t = eventsFrom = 0; // loop
      }
      lastNow = now;
      scrub.value = String(t);
      time.textContent = `${t.toFixed(1)} s`;
      return viewAt(t);
    },
    takeEvents() {
      const events = eventsBetween(eventsFrom, t);
      eventsFrom = t;
      return events;
    },
  };

  const jump = (to: number) => (t = eventsFrom = Math.max(0, Math.min(LENGTH, to)));
  const togglePlay = () => {
    playing = !playing;
    play.textContent = playing ? 'Pause' : 'Play';
  };
  play.onclick = togglePlay;
  scrub.oninput = () => jump(Number(scrub.value));
  for (const b of controls.querySelectorAll<HTMLButtonElement>('.chapters button')) b.onclick = () => jump(Number(b.dataset.at));

  const setOverview = () => fitView(map);
  const setClose = () => {
    camera.zoom = 8;
    camera.position.set(CLOSE_AT.x, CLOSE_AT.y, 100);
    camera.updateProjectionMatrix();
  };
  $('cr-overview').onclick = setOverview;
  $('cr-close').onclick = setClose;
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '1') setOverview();
    if (e.key === '2') setClose();
    if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    }
  });

  await drawMap(map);
  session.commanderSide = 'nato';
  session.enemySide = 'pact';
  session.host = host;
  setOverview();

  // Bring in the real Console render loop once the host and map are ready.
  await import('../main');
}

void startCommanderReview();
