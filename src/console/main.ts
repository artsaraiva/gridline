// Bare Console entry: wires the modules and runs the render loop, one line per layer.
import './input';
import { drawAssetRail } from './chrome/assets';
import { drawChevrons } from './layers/chevrons';
import { drawLastKnown } from './layers/contacts';
import { drawEffects, hideEffectLabels } from './layers/effects';
import { addImpact, drawImpacts } from './layers/impacts';
import { addDeathMarker, drawDeathMarkers } from './layers/markers';
import { drawPoint } from './layers/points';
import { checkEnd } from './match-flow';
import { drawReadout } from './readout';
import { camera, pxToWorld, renderer, scene } from './renderer';
import { session } from './session';

const CHEVRON_PX = 14;

renderer.setAnimationLoop(() => {
  const host = session.host;
  if (!host) {
    drawReadout(null);
    drawAssetRail(null);
    hideEffectLabels();
    renderer.render(scene, camera);
    return;
  }
  const now = performance.now();
  const view = host.sample(now);
  for (const e of host.takeEvents()) {
    if (e.kind === 'death') addDeathMarker(e.x, e.y, e.side, now);
    else if (e.kind === 'impact') addImpact(e.x, e.y, now);
  }
  const scale = CHEVRON_PX * pxToWorld();
  drawAssetRail(view); // before the effects: their labels keep clear of the map Confirm button it places
  drawImpacts(now);
  drawEffects(view, scale, now);
  drawDeathMarkers(now, scale);
  drawLastKnown(view, scale);
  drawChevrons(view, scale);
  view.points.forEach(drawPoint);
  checkEnd(view);
  drawReadout(view);
  renderer.render(scene, camera);
});
