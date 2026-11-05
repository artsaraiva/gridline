// Bare Console: stand-in map plane, chevrons, Capture Point rings, death markers, Tickets, clock and Squads, mouse pan and zoom.
import * as THREE from 'three/webgpu';
import { startSimHost } from '../host/host';
import type { FriendlyView, PointView, SoldierView, SideId, SquadView } from '../sim/types';

const COLOR = { bone: 0xe8e2c8, friendly: 0x6fd0ff, hostile: 0xff4b3e, ground: 0x262c22 };
const CHEVRON_PX = 14;
const DEATH_MARKER_MS = 5000;

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
function drawChevrons(list: (SoldierView | FriendlyView)[], kind: 'friendly' | 'hostile', seen: Set<string>, scale: number) {
  for (const c of list) {
    const key = `${kind}${c.id}`;
    let mesh = chevrons.get(key);
    if (!mesh) {
      mesh = new THREE.Mesh(chevronGeometry, flat(COLOR[kind]));
      (mesh.material as THREE.MeshBasicMaterial).transparent = true;
      scene.add(mesh);
      chevrons.set(key, mesh);
    }
    mesh.position.set(c.x, c.y, 1);
    mesh.rotation.z = Math.atan2(c.fy, c.fx);
    mesh.scale.setScalar(scale);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 'state' in c && c.state === 'wounded' ? 0.35 : 1;
    seen.add(key);
  }
}

// Death markers: an X where a Soldier died, fading out over DEATH_MARKER_MS.
const barGeometry = new THREE.PlaneGeometry(1.1, 0.22);
const deathMarkers: { mark: THREE.Group; material: THREE.MeshBasicMaterial; at: number }[] = [];
function addDeathMarker(x: number, y: number, side: SideId, at: number) {
  const material = flat(COLOR[side === commanderSide ? 'friendly' : 'hostile']);
  material.transparent = true;
  const mark = new THREE.Group();
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new THREE.Mesh(barGeometry, material);
    bar.rotation.z = angle;
    mark.add(bar);
  }
  mark.position.set(x, y, 0.8);
  scene.add(mark);
  deathMarkers.push({ mark, material, at });
}
function drawDeathMarkers(now: number, scale: number) {
  for (let i = deathMarkers.length - 1; i >= 0; i--) {
    const { mark, material, at } = deathMarkers[i]!;
    const left = 1 - (now - at) / DEATH_MARKER_MS;
    if (left > 0) {
      material.opacity = left;
      mark.scale.setScalar(scale * 0.8);
      continue;
    }
    scene.remove(mark);
    material.dispose();
    deathMarkers.splice(i, 1);
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

/** "ALPHA ■■■□ +7 +--": living members, then each dead member's respawn timer (-- = waiting for quiet); or the redeploy countdown. */
function squadLine(q: SquadView): string {
  const name = q.name.padEnd(8);
  if (q.redeployIn !== null) return `${name}WIPED · REDEPLOY ${Math.ceil(q.redeployIn)}`;
  const pips = '■'.repeat(q.strength) + '□'.repeat(q.size - q.strength);
  return `${name}${pips} ${q.respawnIn.map((s) => (s > 0 ? `+${Math.ceil(s)}` : '+--')).join(' ')}`.trimEnd();
}

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const view = host.sample(now);
  for (const e of host.takeEvents()) if (e.kind === 'death') addDeathMarker(e.x, e.y, e.side, now);
  const seen = new Set<string>();
  const scale = CHEVRON_PX * pxToWorld();
  drawDeathMarkers(now, scale);
  drawChevrons(view.friendlies, 'friendly', seen, scale);
  drawChevrons(view.contacts, 'hostile', seen, scale);
  for (const [key, mesh] of chevrons) mesh.visible = seen.has(key);
  view.points.forEach(drawPoint);
  const result = view.result && (view.result.winner === null ? 'DRAW' : view.result.winner === commanderSide ? 'VICTORY' : 'DEFEAT');
  readout.textContent =
    `${commanderSide} ${view.tickets[commanderSide]}   ${enemySide} ${view.tickets[enemySide]}   ${clock(view.seconds)}` +
    (result ? `\n${result} · ${view.result!.reason}` : '') +
    `\n\n${view.squads.map(squadLine).join('\n')}` +
    `\n\nseed ${seed}`;
  renderer.render(scene, camera);
});
