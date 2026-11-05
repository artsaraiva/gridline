// Bare Console entry: wires the modules and runs the render loop, one line per layer.
import './input';
import { drawChevrons } from './layers/chevrons';
import { drawLastKnown } from './layers/contacts';
import { addDeathMarker, drawDeathMarkers } from './layers/markers';
import { drawHqs, drawPoint } from './layers/points';
import { drawSquads } from './layers/squads';
import { UNIT_PX } from './layers/symbols';
import { checkEnd } from './match-flow';
import { drawReadout } from './readout';
import { renderFeed } from './post';
import { metresPerPx, pxToWorld, renderer } from './renderer';
import { session } from './session';

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
  const scale = UNIT_PX * metresPerPx.value; // one symbol unit in metres
  drawDeathMarkers(now, scale);
  drawLastKnown(view, scale);
  drawChevrons(view, scale);
  drawHqs(host.map, scale);
  for (const p of view.points) drawPoint(p, scale);
  drawSquads(view, scale);
  checkEnd(view);
  drawReadout(view);
  renderFeed();
});
