// Asset effects on the map: the armed Asset's preview ring (with its grid and the distance to the nearest friendly
// Squad) and each working Asset's ring with its time left; the Scan UAV circles its ring. Labels are DOM tags over the
// canvas and keep clear of the map Confirm button.
import * as THREE from 'three/webgpu';
import { gridRef } from '../../sim/grid-ref';
import type { CommanderView, Vec2 } from '../../sim/types';
import { COLOR, layer, toScreen } from '../renderer';
import { session } from '../session';
import { clock } from '../summary';
import { overlaps, targeting, validSpot } from '../targeting';
import { css, dashedRing, fading } from './symbols';

const crateGeometry = new THREE.PlaneGeometry(1, 1);
const NAME = { scan: 'Scan UAV', supply: 'Supply Drop', barrage: 'Barrage' };
const discGeometry = new THREE.CircleGeometry(1, 96);
const uavGeometry = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0.6, 0), new THREE.Vector2(-0.5, 0.5), new THREE.Vector2(-0.2, 0), new THREE.Vector2(-0.5, -0.5)]));

/** A ring, a faint disc and markers, pooled: rings carry no id, so they are reused in draw order. */
type Ring = { group: THREE.Group; ring: ReturnType<typeof dashedRing>; disc: THREE.Mesh; uav: THREE.Mesh; crate: THREE.Mesh };
const pool: Ring[] = [];
const labelBox = document.getElementById('labels')!;
const labels: HTMLElement[] = [];

export const resetEffects = () => (pool.length = 0);

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicMaterial;

function ringAt(i: number, p: Vec2, radius: number, color: number, fill: number): Ring {
  let r = pool[i];
  if (!r) {
    r = {
      group: new THREE.Group(),
      ring: dashedRing(120, color, { dash: 2, gap: 6, width: 2 }),
      disc: new THREE.Mesh(discGeometry, fading(color, fill)),
      uav: new THREE.Mesh(uavGeometry, fading(color)),
      crate: new THREE.Mesh(crateGeometry, fading(color)),
    };
    r.group.add(r.disc, r.ring.mesh, r.uav, r.crate);
    layer.add(r.group);
    pool.push(r);
  }
  r.group.visible = true;
  r.group.position.set(p.x, p.y, 0.5);
  r.disc.scale.setScalar(radius);
  r.ring.r.value = radius;
  r.ring.alpha.value = 0.85;
  r.ring.tint.value.setHex(color);
  material(r.disc).color.setHex(color);
  material(r.disc).opacity = fill;
  material(r.uav).color.setHex(color);
  material(r.crate).color.setHex(color);
  r.uav.visible = false;
  r.crate.visible = false;
  return r;
}

/** Places tag `i` at the world spot `p`, offset in px; moved above the map Confirm button if it would sit under it. */
function label(i: number, p: Vec2, dx: number, dy: number, text: string, color: string) {
  let el = labels[i];
  if (!el) {
    el = labelBox.appendChild(document.createElement('span'));
    labels.push(el);
  }
  el.hidden = false;
  el.textContent = text;
  el.style.color = color;
  const s = toScreen(p);
  let x = s.x + dx;
  let y = s.y + dy;
  const confirm = document.getElementById('confirm')!;
  if (!confirm.hidden) {
    const c = confirm.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (overlaps({ left: x, top: y, right: x + w, bottom: y + h }, c)) y = c.top - h - 4;
  }
  el.style.transform = `translate(${x}px, ${y}px)`;
}

/** `scale` is the chevron size in metres (constant on screen), used for the orbiting UAV marker. */
export function drawEffects(view: CommanderView, scale: number, now: number) {
  let rings = 0;
  let tags = 0;
  for (const e of view.effects ?? []) {
    const danger = e.asset === 'barrage';
    const r = ringAt(rings++, e, e.radius, danger ? COLOR.hostile : COLOR.friendly, danger ? 0.1 : 0.06);
    for (const shell of e.shells ?? []) ringAt(rings++, shell, 2 + 10 * (1 - shell.flight), COLOR.hostile, 0.2); // a shell coming down
    if (e.asset === 'scan') {
      const a = (now / 1000) * 0.35;
      r.uav.visible = true;
      r.uav.scale.setScalar(scale * 1.4);
      r.uav.position.set(Math.cos(a) * e.radius, Math.sin(a) * e.radius, 0.1);
      r.uav.rotation.z = a + Math.PI / 2;
    }
    let time = clock(Math.ceil(e.left));
    if (e.landsIn !== undefined && e.fall) { // a Supply Drop crate: it drops toward its spot, growing smaller and brighter, then sits
      const high = e.landsIn / e.fall;
      r.crate.visible = true;
      r.crate.scale.setScalar(scale * (1.2 + high));
      r.crate.position.set(0, high * 40, 0.1);
      material(r.crate).opacity = 1 - 0.6 * high;
      r.ring.alpha.value = 0.35 + 0.5 * (1 - high);
      if (high) time = `LANDS ${clock(Math.ceil(e.landsIn))}`;
    }
    if (e.impactIn) time = `IMPACT ${clock(Math.ceil(e.impactIn))}`; // the Barrage counts down to its first shell
    label(tags++, { x: e.x + e.radius * 0.72, y: e.y + e.radius * 0.72 }, 6, -18, `${NAME[e.asset].toUpperCase()} ${time}`, css(danger ? COLOR.hostile : COLOR.friendly));
  }
  const at = targeting.armed && (targeting.spot ?? targeting.pointer);
  const radius = targeting.armed && view.assets?.find((a) => a.asset === targeting.armed)?.radius;
  if (at && radius) {
    const color = validSpot(at) ? COLOR.bone : COLOR.hostile;
    ringAt(rings++, at, radius, color, targeting.spot ? 0.12 : 0.06);
    const edge = { x: at.x + radius * 0.72, y: at.y + radius * 0.72 };
    const g = session.host?.map.grid;
    label(tags++, edge, 6, -18, `${NAME[targeting.armed!].toUpperCase()} ${g ? gridRef(g, at) : ''}`, css(color));
    const near = nearestSquad(view, at);
    if (near) label(tags++, edge, 6, 2, `${near.name.toUpperCase()} ${Math.round(near.d)} M`, css(color));
  }
  for (let i = rings; i < pool.length; i++) pool[i]!.group.visible = false;
  for (let i = tags; i < labels.length; i++) labels[i]!.hidden = true;
}

/** The friendly Squad with a Soldier nearest `p`, and that distance in metres. */
function nearestSquad(view: CommanderView, p: Vec2) {
  let best: { name: string; d: number } | null = null;
  for (const f of view.friendlies) {
    const d = Math.sqrt((f.x - p.x) ** 2 + (f.y - p.y) ** 2);
    if (best && d >= best.d) continue;
    best = { name: view.squads.find((q) => q.id === f.squad)?.name ?? '', d };
  }
  return best;
}

/** Hides every tag (between matches). */
export const hideEffectLabels = () => labels.forEach((el) => (el.hidden = true));
