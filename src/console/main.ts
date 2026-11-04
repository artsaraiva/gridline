// Bare Console: stand-in map plane, chevrons, Capture Point rings, Tickets and clock, mouse pan and zoom.
import * as THREE from 'three/webgpu';
import { startSimHost } from '../host/host';
import type { PointView, SoldierView, SideId } from '../sim/types';

const COLOR = { bone: 0xe8e2c8, friendly: 0x6fd0ff, hostile: 0xff4b3e, ground: 0x262c22 };
const CHEVRON_PX = 14;

const params = new URLSearchParams(location.search);
const commanderSide: SideId = params.get('side') === 'pact' ? 'pact' : 'nato';
const seed = Number(params.get('seed') ?? 4); // seed 4 shows a decisive capture on the test field
const host = await startSimHost({
  kind: 'start',
  seed,
  squadsPerSide: Number(params.get('squads') ?? 3),
  commanderSide,
});

const renderer = new THREE.WebGPURenderer({ antialias: true }); // falls back to WebGL 2 without WebGPU
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f0c);

// Orthographic camera looking down -z: x east, y north, world units are metres.
const VIEW_M = 680; // world height shown at zoom 1: the whole Play Area
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
camera.position.z = 100;
function resize() {
  const aspect = innerWidth / innerHeight;
  camera.left = (-VIEW_M / 2) * aspect;
  camera.right = (VIEW_M / 2) * aspect;
  camera.top = VIEW_M / 2;
  camera.bottom = -VIEW_M / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
resize();
addEventListener('resize', resize);

// Stand-in map: a flat plane under the Play Area outline.
const flat = (color: number) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(640, 640), flat(COLOR.ground)));
const outline = [...host.map.playArea, host.map.playArea[0]!].map((p) => new THREE.Vector3(p.x, p.y, 0.1)); // WebGPURenderer has no LineLoop
scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: COLOR.bone })));

// Capture Points: owner ring plus a progress arc toward whichever Side the meter favours.
const sideColor = (s: SideId | null) => (s === null ? COLOR.bone : s === commanderSide ? COLOR.friendly : COLOR.hostile);
const rings = new Map<string, { ring: THREE.Mesh; arc: THREE.Mesh; progress: number }>();
function drawPoint(p: PointView) {
  let r = rings.get(p.id);
  if (!r) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius - 1.2, p.radius, 64), flat(COLOR.bone));
    const arc = new THREE.Mesh(new THREE.BufferGeometry(), flat(COLOR.bone));
    ring.position.set(p.x, p.y, 0.2);
    arc.position.set(p.x, p.y, 0.3);
    scene.add(ring, arc);
    r = { ring, arc, progress: NaN };
    rings.set(p.id, r);
  }
  (r.ring.material as THREE.MeshBasicMaterial).color.setHex(sideColor(p.owner));
  if (p.progress === r.progress) return;
  r.progress = p.progress;
  r.arc.geometry.dispose();
  r.arc.geometry = new THREE.RingGeometry(p.radius + 1, p.radius + 4, 64, 1, Math.PI / 2, -Math.abs(p.progress) * Math.PI * 2);
  (r.arc.material as THREE.MeshBasicMaterial).color.setHex(sideColor(p.progress > 0 ? 'nato' : 'pact'));
}

// Chevrons: one mesh per Soldier, pointing +x before rotation, constant size on screen.
const chevronShape = new THREE.Shape([
  new THREE.Vector2(0.6, 0),
  new THREE.Vector2(-0.5, 0.5),
  new THREE.Vector2(-0.2, 0),
  new THREE.Vector2(-0.5, -0.5),
]);
const chevronGeometry = new THREE.ShapeGeometry(chevronShape);
const chevrons = new Map<string, THREE.Mesh>();
function drawChevrons(list: SoldierView[], kind: 'friendly' | 'hostile', seen: Set<string>, scale: number) {
  for (const c of list) {
    const key = `${kind}${c.id}`;
    let mesh = chevrons.get(key);
    if (!mesh) {
      mesh = new THREE.Mesh(chevronGeometry, flat(COLOR[kind]));
      scene.add(mesh);
      chevrons.set(key, mesh);
    }
    mesh.position.set(c.x, c.y, 1);
    mesh.rotation.z = Math.atan2(c.fy, c.fx);
    mesh.scale.setScalar(scale);
    seen.add(key);
  }
}

// Pan with drag, zoom with the wheel around the cursor.
const pxToWorld = () => (camera.top - camera.bottom) / camera.zoom / innerHeight;
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
  },
  { passive: false },
);

const readout = document.getElementById('readout')!;
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const enemySide: SideId = commanderSide === 'nato' ? 'pact' : 'nato';

renderer.setAnimationLoop(() => {
  const view = host.sample(performance.now());
  const seen = new Set<string>();
  const scale = CHEVRON_PX * pxToWorld();
  drawChevrons(view.friendlies, 'friendly', seen, scale);
  drawChevrons(view.contacts, 'hostile', seen, scale);
  for (const [key, mesh] of chevrons) mesh.visible = seen.has(key);
  view.points.forEach(drawPoint);
  const result = view.result && (view.result.winner === null ? 'DRAW' : view.result.winner === commanderSide ? 'VICTORY' : 'DEFEAT');
  readout.textContent =
    `${commanderSide} ${view.tickets[commanderSide]}   ${enemySide} ${view.tickets[enemySide]}   ${clock(view.seconds)}` +
    (result ? `\n${result} · ${view.result!.reason}` : '') +
    `\nseed ${seed}`;
  renderer.render(scene, camera);
});
