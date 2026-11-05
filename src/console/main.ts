// Bare Console: match setup and end screens, stand-in map plane, chevrons, Capture Point rings, death markers, Tickets, clock and Squads, mouse pan and zoom.
import * as THREE from 'three/webgpu';
import { startSimHost, type SimHost } from '../host/host';
import type { MatchSetup } from '../host/protocol';
import { enemyOf, type FriendlyView, type PointView, type SoldierView, type SideId, type SquadView } from '../sim/types';
import { clock, endSummary, FACTION } from './summary';

const COLOR = { bone: 0xe8e2c8, friendly: 0x6fd0ff, hostile: 0xff4b3e, ground: 0x262c22 };
const CHEVRON_PX = 14;
const DEATH_MARKER_MS = 5000;

const MIN_SQUADS = 3;
const MAX_SQUADS = 8;

let host: SimHost | null = null;
let commanderSide: SideId = 'nato';
let enemySide: SideId = 'pact';
let seed = 0;
let ended = false;

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

// Everything drawn for one match lives in `layer`, dropped whole when the next match starts.
// ponytail: dropped objects' materials and ring geometries are not disposed; a few dozen leak per match.
let layer = new THREE.Group();
scene.add(layer);

// Stand-in map: a flat plane under the Play Area outline.
const flat = (color: number) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
function drawMap() {
  layer.add(new THREE.Mesh(new THREE.PlaneGeometry(640, 640), flat(COLOR.ground)));
  const outline = [...host!.map.playArea, host!.map.playArea[0]!].map((p) => new THREE.Vector3(p.x, p.y, 0.1)); // WebGPURenderer has no LineLoop
  layer.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color: COLOR.bone })));
}

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
    layer.add(ring, arc);
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
      layer.add(mesh);
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
  layer.add(mark);
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
    layer.remove(mark);
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

/** "ALPHA ■■■□ +7 +--": living members, then each dead member's respawn timer (-- = waiting for quiet); or the redeploy countdown. */
function squadLine(q: SquadView): string {
  const name = q.name.padEnd(8);
  if (q.redeployIn !== null) return `${name}WIPED · REDEPLOY ${Math.ceil(q.redeployIn)}`;
  const pips = '■'.repeat(q.strength) + '□'.repeat(q.size - q.strength);
  return `${name}${pips} ${q.respawnIn.map((s) => (s > 0 ? `+${Math.ceil(s)}` : '+--')).join(' ')}`.trimEnd();
}

// Match flow: the setup screen starts a match, the end screen shows how it went and leads back to setup.
const setupForm = document.getElementById('setup') as HTMLFormElement;
const endScreen = document.getElementById('end')!;
const squadSelect = setupForm.elements.namedItem('squads') as HTMLSelectElement;
for (let n = MIN_SQUADS; n <= MAX_SQUADS; n++) squadSelect.add(new Option(String(n), String(n)));

// URL params preset the setup screen; `seed` fixes the first match's seed (seed 4 shows a decisive capture on the test field).
const params = new URLSearchParams(location.search);
let urlSeed = params.get('seed');
(setupForm.elements.namedItem('side') as RadioNodeList).value = params.get('side') === 'pact' ? 'pact' : 'nato';
squadSelect.value = String(Math.min(MAX_SQUADS, Math.max(MIN_SQUADS, Number(params.get('squads')) || MIN_SQUADS)));

async function startMatch(setup: MatchSetup) {
  host?.stop();
  host = null;
  scene.remove(layer);
  layer = new THREE.Group();
  scene.add(layer);
  rings.clear();
  chevrons.clear();
  deathMarkers.length = 0;
  commanderSide = setup.commanderSide;
  enemySide = enemyOf(commanderSide);
  seed = setup.seed;
  ended = false;
  host = await startSimHost({ kind: 'start', ...setup });
  drawMap();
}

setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(setupForm);
  const matchSeed = Number.isFinite(Number(urlSeed ?? NaN)) ? Number(urlSeed) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  urlSeed = null;
  setupForm.hidden = true;
  void startMatch({
    commanderSide: data.get('side') === 'pact' ? 'pact' : 'nato',
    squadsPerSide: Number(data.get('squads')),
    seed: matchSeed,
  });
});

function showEnd(summary: ReturnType<typeof endSummary>) {
  const set = (id: string, text: string) => (document.getElementById(id)!.textContent = text);
  set('end-result', summary.result);
  set('end-reason', summary.reason);
  set('end-friendly', `${summary.friendly.faction} ${summary.friendly.tickets}`);
  set('end-enemy', `${summary.enemy.faction} ${summary.enemy.tickets}`);
  set('end-time', summary.time);
  set('end-seed', String(seed));
  set('end-copy', 'Copy match record');
  endScreen.hidden = false;
}

document.getElementById('end-copy')!.addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(JSON.stringify(host!.record(), null, 2));
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
});

document.getElementById('end-new')!.addEventListener('click', () => {
  host?.stop();
  host = null;
  endScreen.hidden = true;
  setupForm.hidden = false;
});

renderer.setAnimationLoop(() => {
  if (!host) {
    readout.hidden = true;
    renderer.render(scene, camera);
    return;
  }
  readout.hidden = false;
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
  // the record arrives with the final view, so wait for both before showing the end screen
  if (view.result && host.record() && !ended) {
    ended = true;
    showEnd(endSummary(view));
  }
  readout.textContent =
    `${FACTION[commanderSide]} ${view.tickets[commanderSide]}   ${FACTION[enemySide]} ${view.tickets[enemySide]}   ${clock(view.seconds)}` +
    `\n\n${view.squads.map(squadLine).join('\n')}` +
    `\n\nseed ${seed}`;
  renderer.render(scene, camera);
});
