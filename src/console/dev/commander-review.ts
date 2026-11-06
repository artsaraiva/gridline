// DEV-only Commander look review scene (#69): the real Kaltenbach bake and the real Console layers and post chain, driven
// by the scripted timeline in commander-review-timeline.ts instead of a Simulation, so the readability treatments (#70,
// #71) are judged on every Squad Leader state. This file is only reachable through dev-commander-review.html.
import { loadBakedMap } from '../../maps/load';
import { DEFAULT_TUNE } from '../../sim/tune';
import { CHAPTERS, CLOSE_AT, eventsBetween, LENGTH, viewAt } from './commander-review-timeline';
import { $, startScriptedHost } from './scripted-host';
import './review-controls.css';

/** Starts the review scene. */
export async function startCommanderReview() {
  if (!import.meta.env.DEV) {
    throw new Error('Commander review scene is DEV-only');
  }

  $('setup').hidden = true;
  $('end').hidden = true;

  const controls = document.createElement('div');
  controls.id = 'commander-review-controls';
  controls.className = 'review-controls';
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

  const map = await loadBakedMap(`${import.meta.env.BASE_URL}maps/kaltenbach`, DEFAULT_TUNE.cellM);
  const { jump } = await startScriptedHost(map, 'cr', { length: LENGTH, viewAt, eventsBetween }, { ...CLOSE_AT, zoom: 8 });
  for (const b of controls.querySelectorAll<HTMLButtonElement>('.chapters button')) b.onclick = () => jump(Number(b.dataset.at));
}

void startCommanderReview();
