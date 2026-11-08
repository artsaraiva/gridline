// DEV-only Asset review scene (#60): Barrage, Scan UAV and Supply Drop cycle together
// on the real Kaltenbach bake, using the real Simulation and real Console layers.
// This file is only reachable through dev-asset-review.html; production builds ignore it.
import { startSimHost } from '../../host/host';
import type { AssetKind } from '../../sim/types';
import { drawMap, fitView } from '../layers/map';
import { camera } from '../renderer';
import { session } from '../session';
import { ASSETS, CYCLE_SECONDS } from './asset-review-config';
import './asset-review.css';

function $(id: string) {
  return document.getElementById(id)!;
}

function setOverview() {
  const host = session.host;
  if (!host) return;
  fitView(host.map);
}

function setClose() {
  // Close tactical zoom centred on the Asset cluster near the map centre.
  camera.zoom = 8;
  camera.position.set(0, 20, 100);
  camera.updateProjectionMatrix();
}

/** Close tactical zoom centred on one Asset's call spot. */
function setFocus(asset: AssetKind) {
  const { at } = ASSETS.find((a) => a.asset === asset)!;
  camera.zoom = 8;
  camera.position.set(at.x, at.y, 100);
  camera.updateProjectionMatrix();
}

/** #107: close tactical zoom that keeps nato's tank (the Simulation drives it) in the middle. */
function followTank() {
  camera.zoom = 8;
  camera.updateProjectionMatrix();
  setInterval(() => {
    const v = session.view?.vehicles?.find((x) => x.side === 'nato' && !x.wreck);
    if (v) camera.position.set(v.x, v.y, 100);
  }, 100);
}

/** `?focus=barrage|scan|supply` frames that Asset close up, `?focus=tank` follows nato's tank, `?focus=close` the cluster; anything else is the overview. */
function applyFocus(focus: string | null) {
  if (focus === 'close') setClose();
  else if (focus === 'tank') followTank();
  else if (ASSETS.some((a) => a.asset === focus)) setFocus(focus as AssetKind);
  else setOverview();
}

/** Starts the review scene and returns a cleanup that stops the Asset cycling. */
export async function startAssetReview(): Promise<() => void> {
  if (!import.meta.env.DEV) {
    throw new Error('Asset review scene is DEV-only');
  }

  document.body.classList.add('asset-review');
  $('setup').hidden = true;
  $('end').hidden = true;
  $('rail').hidden = false;
  $('faction-cell').textContent = 'NATO';
  $('faction-sub').textContent = 'Kaltenbach · Asset review';
  $('assets').hidden = false;

  const controls = document.createElement('div');
  controls.id = 'asset-review-controls';
  controls.innerHTML = `
    <div class="eyebrow">DEV review / #60</div>
    <h2>Asset review</h2>
    <p>Barrage · Scan UAV · Supply Drop cycling on the real bake.</p>
    <div class="row">
      <button id="ar-overview" type="button">Overview</button>
      <button id="ar-close" type="button">Close tactical</button>
    </div>
    <small>Real Simulation + Console layers. Production entry is <code>index.html</code>.</small>
  `;
  document.body.appendChild(controls);
  document.getElementById('ar-overview')!.onclick = setOverview;
  document.getElementById('ar-close')!.onclick = setClose;

  const host = await startSimHost({
    kind: 'start',
    map: 'kaltenbach',
    commanderSide: 'nato',
    squadsPerSide: 3,
    seed: 60,
    dev: { freeAssets: true },
  });

  await drawMap(host.map);
  session.commanderSide = 'nato';
  session.enemySide = 'pact';
  session.host = host;
  setOverview();

  // Bring in the real Console render loop once the host and map are ready.
  await import('../main');
  applyFocus(new URLSearchParams(location.search).get('focus'));
  document.body.dataset.reviewReady = 'true'; // scripts/review-capture.mjs waits for this

  function callAll() {
    for (const { asset, at } of ASSETS) host.send({ side: 'nato', kind: 'asset', asset, at });
  }
  callAll();
  const interval = setInterval(callAll, CYCLE_SECONDS * 1000);

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === '1') setOverview();
    if (e.key === '2') setClose();
  });

  return () => {
    clearInterval(interval);
    host.stop();
    controls.remove();
  };
}

void startAssetReview();
