// Bare Console entry: wires the modules and runs the render loop, one line per layer.
import './input';
import { applyMix, soundEvents, soundFrame } from './audio';
import { drawAssetRail } from './chrome/assets';
import { bindMixer } from './chrome/mixer';
import { drawRadioLog, logRadio, showRadioLog } from './chrome/radio-log';
import { drawRail, showAward, toastEvent } from './chrome/rail';
import { drawSquads } from './chrome/squads';
import { drawChevrons, pulse } from './layers/chevrons';
import { drawLastKnown } from './layers/contacts';
import { drawEffects, hideEffectLabels } from './layers/effects';
import { drawGrid } from './layers/grid';
import { addImpact, drawImpacts } from './layers/impacts';
import { addDeathMarker, drawDeathMarkers } from './layers/markers';
import { watchFrame } from './layers/map';
import { drawOrders, hideOrderTags } from './layers/orders';
import { drawHqs, drawPoint } from './layers/points';
import { UNIT_PX } from './layers/symbols';
import { addShot, drawTracers } from './layers/tracers';
import { checkEnd } from './match-flow';
import { renderFeed } from './post';
import { metresPerPx, pxToWorld, renderer } from './renderer';
import { session } from './session';

bindMixer(applyMix);

let lastFrame = performance.now();
renderer.setAnimationLoop(() => {
  const host = session.host;
  const now = performance.now();
  if (!host) {
    session.view = null;
    drawRail(null);
    drawAssetRail(null);
    drawSquads(null);
    showRadioLog(false);
    drawGrid(null, 0);
    hideEffectLabels();
    hideOrderTags();
    lastFrame = now;
    renderFeed();
    return;
  }
  watchFrame(now - lastFrame, host.map);
  lastFrame = now;
  const view = host.sample(now);
  session.view = view;
  const events = host.takeEvents();
  for (const e of events) {
    if (e.kind === 'death') addDeathMarker(e.x, e.y, e.side, now);
    else if (e.kind === 'impact') addImpact(e.x, e.y, now);
    else if (e.kind === 'shot' || e.kind === 'suppressive') {
      addShot(e, view, now);
      pulse(e.from, e.side, now);
    }
    logRadio(e, view);
    toastEvent(e, view);
    showAward(e, view);
  }
  metresPerPx.value = pxToWorld();
  const scale = UNIT_PX * metresPerPx.value; // one symbol unit in metres
  drawRail(view);
  drawAssetRail(view); // before the effects: their labels keep clear of the map Confirm button it places
  drawSquads(view);
  showRadioLog(true);
  drawRadioLog(now);
  drawGrid(view, now);
  drawImpacts(now);
  drawEffects(view, scale, now);
  drawOrders(view, metresPerPx.value);
  drawDeathMarkers(now, scale);
  drawLastKnown(view, scale);
  drawChevrons(view, scale, now);
  drawHqs(host.map, scale);
  for (const p of view.points) drawPoint(p, scale);
  drawTracers(now, scale);
  if (!view.result) {
    soundEvents(events, view); // #85: combat cues for the sources the layers drew this frame; the radio log ducks them while a line is on air
    soundFrame(view, host.map.hqs[view.side], now / 1000); // the looping cues (UAV, shells, crate) follow drawEffects
  }
  checkEnd(view);
  renderFeed();
});
