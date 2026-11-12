// Asset effects on the map: the armed Asset's preview ring (with its grid and the distance to the nearest friendly
// Squad) and each working Asset's ring with its time left. Labels are DOM tags over the canvas and keep clear of the
// map Confirm button. The baked objects (Scan UAV, Supply Drop crate, shells, impacts) each have a layer of their own (#77).
// The Barrage ring turns while it works and pulses on each impact (#98).
import * as THREE from 'three/webgpu';
import { gridRef } from '../../sim/grid-ref';
import type { CommanderView, Vec2 } from '../../sim/types';
import { COLOR, pool, toScreen } from '../renderer';
import { session } from '../session';
import { lastImpactAt } from './impacts';
import { clock, eliteSquad } from '../summary';
import { overlaps, targeting, validSpot } from '../targeting';
import { css, dashedRing, fading } from './symbols';

const NAME = { scan: 'Scan UAV', supply: 'Supply Drop', barrage: 'Barrage', missile: 'Missile' };
const discGeometry = new THREE.CircleGeometry(1, 96);
/** The Barrage ring turns this fast while it works, so an ongoing strike reads at a glance. */
const RING_TURN_RAD_PER_S = 0.25;
const RING_PULSE_MS = 600;

/** A ring and a faint disc, pooled: rings carry no id, so they are reused in draw order. */
const rings = pool(() => {
  const ring = dashedRing(120, COLOR.friendly, { dash: 2, gap: 6, width: 2 });
  const disc = new THREE.Mesh(discGeometry, fading(COLOR.friendly, 0.06));
  return Object.assign(new THREE.Group().add(disc, ring.mesh), { ring, disc });
});
const labelBox = document.getElementById('labels')!;
const labels: HTMLElement[] = [];

const material = (m: THREE.Mesh) => m.material as THREE.MeshBasicMaterial;

function ringAt(p: Vec2, radius: number, color: number, fill: number) {
  const r = rings.next();
  r.position.set(p.x, p.y, 0.5);
  r.disc.scale.setScalar(radius);
  r.ring.r.value = radius;
  r.ring.alpha.value = 0.85;
  r.ring.tint.value.setHex(color);
  material(r.disc).color.setHex(color);
  material(r.disc).opacity = fill;
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

export function drawEffects(view: CommanderView, now: number) {
  let tags = 0;
  for (const e of view.effects ?? []) {
    if (e.asset === 'missile') continue; // #99: layers/missile.ts draws its marker, ring and line
    const danger = e.asset === 'barrage';
    const r = ringAt(e, e.radius, danger ? COLOR.hostile : COLOR.friendly, danger ? 0.1 : 0.06);
    r.ring.mesh.rotation.z = danger ? (now / 1000) * RING_TURN_RAD_PER_S : 0;
    if (danger) r.ring.alpha.value = 0.7 + 0.3 * Math.max(0, 1 - (now - lastImpactAt('barrage')) / RING_PULSE_MS);
    let time = clock(Math.ceil(e.left));
    if (e.landsIn !== undefined && e.fall) { // a Supply Drop crate: its ring brightens as it comes down
      const high = e.landsIn / e.fall;
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
    ringAt(at, radius, color, targeting.spot ? 0.12 : 0.06);
    const edge = { x: at.x + radius * 0.72, y: at.y + radius * 0.72 };
    const g = session.host?.map.grid;
    label(tags++, edge, 6, -18, `${NAME[targeting.armed!].toUpperCase()} ${g ? gridRef(g, at) : ''}`, css(color));
    const near = nearestSquad(view, at);
    if (near) label(tags++, edge, 6, 2, `${near.name.toUpperCase()} ${Math.round(near.d)} M`, css(color));
  }
  rings.end();
  for (let i = tags; i < labels.length; i++) labels[i]!.hidden = true;
}

/** The friendly Squad with a Soldier nearest `p`, and that distance in metres; `friendlies` for a Squad that is not Elite (#153). */
function nearestSquad(view: CommanderView, p: Vec2) {
  let best: { name: string; d: number } | null = null;
  for (const f of view.friendlies) {
    const d = Math.sqrt((f.x - p.x) ** 2 + (f.y - p.y) ** 2);
    if (best && d >= best.d) continue;
    best = { name: eliteSquad(view, f.squad)?.name ?? 'friendlies', d };
  }
  return best;
}

/** Hides every tag (between matches). */
export const hideEffectLabels = () => labels.forEach((el) => (el.hidden = true));
