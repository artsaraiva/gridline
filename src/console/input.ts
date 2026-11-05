// Map pointer input: pan with drag, zoom with the wheel around the cursor; a tap (press and release in place) and the
// pointer position go to targeting.
import { burst } from './post';
import { camera, pxToWorld, renderer, toWorld } from './renderer';
import { zoomRange } from './layers/map';
import { hover, tap } from './targeting';

const TAP_PX = 6; // a press that moves less than this is a tap, not a pan
const SAME_SPOT_PX = 24; // a second tap this close to the pinned spot is "the same spot"
const PICK_PX = 14; // a tap this close to a friendly chevron selects its Squad

let drag: { x: number; y: number } | null = null;
let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  drag = down = { x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < TAP_PX) tap(toWorld(e.clientX, e.clientY), SAME_SPOT_PX * pxToWorld(), PICK_PX * pxToWorld());
  drag = down = null;
});
renderer.domElement.addEventListener('pointerleave', () => hover(null));
renderer.domElement.addEventListener('pointermove', (e) => {
  hover(toWorld(e.clientX, e.clientY));
  if (!drag) return;
  const k = pxToWorld();
  camera.position.x -= (e.clientX - drag.x) * k;
  camera.position.y += (e.clientY - drag.y) * k;
  drag = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const before = pxToWorld();
    const cx = e.clientX - innerWidth / 2;
    const cy = innerHeight / 2 - e.clientY;
    camera.zoom = Math.min(zoomRange.max, Math.max(zoomRange.min, camera.zoom * Math.exp(-e.deltaY * 0.0015)));
    camera.updateProjectionMatrix();
    const after = pxToWorld();
    camera.position.x += cx * (before - after); // keep the world point under the cursor fixed
    camera.position.y += cy * (before - after);
    burst(0.3);
  },
  { passive: false },
);
