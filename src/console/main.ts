// Bare Console entry: wires the modules and runs the render loop, one line per layer.
import './input';
import { drawChevrons } from './layers/chevrons';
import { drawLastKnown } from './layers/contacts';
import { addDeathMarker, drawDeathMarkers } from './layers/markers';
import { drawPoint } from './layers/points';
import { checkEnd } from './match-flow';
import { drawReadout } from './readout';
import { renderFeed } from './post';
import { metresPerPx, pxToWorld, renderer } from './renderer';
import { session } from './session';

const CHEVRON_PX = 14;

renderer.setAnimationLoop(() => {
  const host = session.host;
  if (!host) {
    drawReadout(null);
    renderFeed();
    return;
  }
  const now = performance.now();
  const view = host.sample(now);
  for (const e of host.takeEvents()) if (e.kind === 'death') addDeathMarker(e.x, e.y, e.side, now);
  metresPerPx.value = pxToWorld();
  const scale = CHEVRON_PX * metresPerPx.value;
  drawDeathMarkers(now, scale);
  drawLastKnown(view, scale);
  drawChevrons(view, scale);
  view.points.forEach(drawPoint);
  checkEnd(view);
  drawReadout(view);
  renderFeed();
});
