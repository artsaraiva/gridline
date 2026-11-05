// Map pointer input: pan with drag, zoom with the wheel around the cursor.
import { burst } from './post';
import { camera, pxToWorld, renderer } from './renderer';

let drag: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', () => (drag = null));
renderer.domElement.addEventListener('pointermove', (e) => {
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
    camera.zoom = Math.min(20, Math.max(0.5, camera.zoom * Math.exp(-e.deltaY * 0.0015)));
    camera.updateProjectionMatrix();
    const after = pxToWorld();
    camera.position.x += cx * (before - after); // keep the world point under the cursor fixed
    camera.position.y += cy * (before - after);
    burst(0.3);
  },
  { passive: false },
);
