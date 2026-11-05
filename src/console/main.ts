// Bare Console entry: wires the modules and runs the render loop, one line per layer.
import './input';
import { drawAssetRail } from './chrome/assets';
import { drawRadioLog, logRadio, showRadioLog } from './chrome/radio-log';
import { drawSquads } from './chrome/squads';
import { drawChevrons } from './layers/chevrons';
import { drawLastKnown } from './layers/contacts';
import { drawEffects, hideEffectLabels } from './layers/effects';
import { addImpact, drawImpacts } from './layers/impacts';
import { addDeathMarker, drawDeathMarkers } from './layers/markers';
import { drawOrders, hideOrderTags } from './layers/orders';
import { drawHqs, drawPoint } from './layers/points';
import { drawSquadFrames } from './layers/squads';
import { UNIT_PX } from './layers/symbols';
import { addShot, drawTracers } from './layers/tracers';
import { checkEnd } from './match-flow';
import { renderFeed } from './post';
import { drawReadout } from './readout';
import { metresPerPx, pxToWorld, renderer } from './renderer';
import { session } from './session';

renderer.setAnimationLoop(() => {
  const host = session.host;
  if (!host) {
    session.view = null;
    drawReadout(null);
    drawAssetRail(null);
    drawSquads(null);
    showRadioLog(false);
    hideEffectLabels();
    hideOrderTags();
    renderFeed();
    return;
  }
  const now = performance.now();
  const view = host.sample(now);
  session.view = view;
  for (const e of host.takeEvents()) {
    if (e.kind === 'death') addDeathMarker(e.x, e.y, e.side, now);
    else if (e.kind === 'impact') addImpact(e.x, e.y, now);
    else if (e.kind === 'shot' || e.kind === 'suppressive') addShot(e, view, now);
    logRadio(e, view);
  }
  metresPerPx.value = pxToWorld();
  const scale = UNIT_PX * metresPerPx.value; // one symbol unit in metres
  drawAssetRail(view); // before the effects: their labels keep clear of the map Confirm button it places
  drawImpacts(now);
  drawEffects(view, scale, now);
  drawOrders(view, metresPerPx.value);
  drawSquads(view);
  showRadioLog(true);
  drawRadioLog(now);
  drawDeathMarkers(now, scale);
  drawLastKnown(view, scale);
  drawChevrons(view, scale);
  drawHqs(host.map, scale);
  for (const p of view.points) drawPoint(p, scale);
  drawSquadFrames(view, scale);
  drawTracers(now, scale);
  checkEnd(view);
  drawReadout(view);
  renderFeed();
});
