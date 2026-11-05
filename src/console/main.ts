// Bare Console entry: wires the modules and runs the render loop, one line per layer.
import './input';
import { drawAssetRail } from './chrome/assets';
import { logRadio, showRadioLog } from './chrome/radio-log';
import { drawSquads } from './chrome/squads';
import { drawChevrons } from './layers/chevrons';
import { drawLastKnown } from './layers/contacts';
import { drawEffects, hideEffectLabels } from './layers/effects';
import { addDeathMarker, drawDeathMarkers } from './layers/markers';
import { drawOrders, hideOrderTags } from './layers/orders';
import { drawPoint } from './layers/points';
import { checkEnd } from './match-flow';
import { drawReadout } from './readout';
import { camera, pxToWorld, renderer, scene } from './renderer';
import { session } from './session';

const CHEVRON_PX = 14;

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
    renderer.render(scene, camera);
    return;
  }
  const now = performance.now();
  const view = host.sample(now);
  session.view = view;
  for (const e of host.takeEvents()) {
    if (e.kind === 'death') addDeathMarker(e.x, e.y, e.side, now);
    logRadio(e, view);
  }
  const scale = CHEVRON_PX * pxToWorld();
  drawAssetRail(view); // before the effects: their labels keep clear of the map Confirm button it places
  drawEffects(view, scale, now);
  drawOrders(view, pxToWorld());
  drawSquads(view);
  showRadioLog(true);
  drawDeathMarkers(now, scale);
  drawLastKnown(view, scale);
  drawChevrons(view, scale);
  view.points.forEach(drawPoint);
  checkEnd(view);
  drawReadout(view);
  renderer.render(scene, camera);
});
