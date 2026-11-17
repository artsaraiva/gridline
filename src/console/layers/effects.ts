// Asset effects on the map: the armed Asset's preview ring (with its grid and the distance to the nearest friendly
// Squad) and each working Asset's ring with its time left. Labels are DOM tags over the canvas and keep clear of the
// map Confirm button. The baked objects (Scan UAV, Supply Drop crate, shells, impacts) each have a layer of their own (#77).
// The Barrage ring turns while it works and pulses on each impact (#98). #101: the Gunship has no ring once called:
// its focus is a mark (layers/gunship.ts), and only its label is here. #138: a line-shaped Asset (Smoke Screen, Creeping
// Barrage) has a strip in place of the ring: a thin outlined rectangle, in the preview and until its last shell is down.
// #139: the Recon Plane's preview strip runs right across the map; in the air it and the Drone Strike have only a label here.
// #142: the Redeploy Beacon has only its label here too (layers/beacon.ts draws the case, lamp and deny ring); Rapid Deploy has no map effect.
// #143: so do the EMP Strike (layers/emp.ts) and the Feint (layers/feint.ts).
import * as THREE from 'three/webgpu';
import { gridRef } from '../../sim/grid-ref';
import type { AssetKind, CommanderView, Vec2 } from '../../sim/types';
import { ASSET_TABLE } from '../asset-table';
import { type Box, dock, leader } from '../dock';
import { COLOR, metresPerPx, pool, sideColor, toScreen } from '../renderer';
import { session } from '../session';
import { lastImpactAt } from './impacts';
import { clock, eliteSquad } from '../summary';
import { strip, targeting, validSpot } from '../targeting';
import { css, dashedRing, fading, UNIT_PX } from './symbols';

/** #101: how far the Gunship's focus mark reaches from its spot on screen (the Cruise Missile's target mark: a chevron unit). */
export const FOCUS_MARK_PX = UNIT_PX;

/** #184: an Asset's map label as its tag writes it, from ASSET_TABLE. */
const tag = (asset: AssetKind) => ASSET_TABLE[asset].label.toUpperCase();
const discGeometry = new THREE.CircleGeometry(1, 96);
/** The ring's quad is laid out for a radius this big, in metres: over the widest Asset ring. */
const RING_QUAD_M = 400;
/** The Barrage ring turns this fast while it works, so an ongoing strike reads at a glance. */
const RING_TURN_RAD_PER_S = 0.25;
const RING_PULSE_MS = 600;

/** The Scan UAV's ring turns too, slower: a search that is still running. */
const SCAN_TURN_RAD_PER_S = 0.08;

/** A ring and a faint disc, pooled: rings carry no id, so they are reused in draw order. Kept plain: one dotted line, nothing else. */
const rings = pool(() => {
  const ring = dashedRing(RING_QUAD_M, COLOR.friendly, { dash: 2, gap: 6, width: 2 }); // a quad big enough for every Asset ring
  const disc = new THREE.Mesh(discGeometry, fading(COLOR.friendly, 0.06));
  return Object.assign(new THREE.Group().add(disc, ring.mesh), { ring, disc });
});
/** #138: a strip's outline is this wide on screen, whatever the zoom. */
const STRIP_PX = 1.5;
const unitQuad = new THREE.PlaneGeometry(1, 1);
/** #138: a strip: a faint fill and four edges on unit quads, pooled like the rings. */
const strips = pool(() => {
  const fill = new THREE.Mesh(unitQuad, fading(COLOR.friendly, 0.06));
  const edges = [0, 1, 2, 3].map(() => new THREE.Mesh(unitQuad, fading(COLOR.friendly, 0.85)));
  return Object.assign(new THREE.Group().add(fill, ...edges), { fill, edges });
});

/** #138: the strip from `a` to `b`, `width` metres across, outlined in `color`. */
function stripAt(a: Vec2, b: Vec2, width: number, color: number, fill: number) {
  const s = strips.next();
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const w = STRIP_PX * metresPerPx.value;
  s.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.5);
  s.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
  s.fill.scale.set(length, width, 1);
  material(s.fill).opacity = fill;
  s.edges.forEach((e, i) => {
    const side = i < 2; // the two long sides, then the two ends
    const sign = i % 2 ? 1 : -1;
    e.position.set(side ? 0 : (sign * length) / 2, side ? (sign * width) / 2 : 0, 0);
    e.scale.set(side ? length : w, side ? w : width, 1);
  });
  for (const m of [s.fill, ...s.edges]) material(m).color.setHex(color);
}

const labelBox = document.getElementById('labels')!;
const labels: HTMLElement[] = [];
const SVG = 'http://www.w3.org/2000/svg';
/** The leader lines from the tags to their marks, one path a tag, under the tags. */
const leaders = labelBox.appendChild(document.createElementNS(SVG, 'svg'));
leaders.id = 'leaders';

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

/** The tags asked for this frame: each one's element, the box it wants and the mark it belongs to, in screen px. */
const wanted: { el: HTMLElement; box: Box; ax: number; ay: number; color: string }[] = [];

/**
 * Asks for tag `i` beside the world spot `p`, offset in px: the Asset's `name`, dim, and its `value` (a countdown, a Grid
 * Reference), bright in `color`. `dockTags` then places them all.
 */
function label(i: number, p: Vec2, dx: number, dy: number, name: string, value: string, color: string) {
  let el = labels[i];
  if (!el) {
    el = labelBox.appendChild(document.createElement('span'));
    el.className = 'at';
    el.append('', document.createElement('b'));
    labels.push(el);
  }
  el.hidden = false;
  const text = `${name} ${value}`;
  if (el.dataset.t !== text) {
    el.firstChild!.textContent = name;
    el.lastChild!.textContent = value;
    el.dataset.t = text;
    el.dataset.w = ''; // measured again below
  }
  el.style.setProperty('--c', color);
  if (!el.dataset.w) [el.dataset.w, el.dataset.h] = [String(el.offsetWidth), String(el.offsetHeight)];
  const s = toScreen(p);
  wanted.push({ el, box: { x: s.x + dx, y: s.y + dy, w: Number(el.dataset.w), h: Number(el.dataset.h) }, ax: s.x, ay: s.y, color });
}

/** Places this frame's tags, stacked where they would overlap and clear of the map Confirm button, each on a leader line to its mark. */
function dockTags() {
  const confirm = document.getElementById('confirm')!;
  const c = confirm.hidden ? null : confirm.getBoundingClientRect();
  const spots = dock(wanted.map((t) => t.box), c ? [{ x: c.left, y: c.top, w: c.width, h: c.height }] : []);
  wanted.forEach((t, k) => {
    const at = spots[k]!;
    t.el.style.transform = `translate(${at.x}px, ${at.y}px)`;
    let line = leaders.children[k] as SVGPathElement | undefined;
    if (!line) line = leaders.appendChild(document.createElementNS(SVG, 'path'));
    line.setAttribute('d', leader(t.ax, t.ay, { ...t.box, ...at }));
    line.setAttribute('stroke', t.color);
    line.style.display = '';
  });
  for (let k = wanted.length; k < leaders.children.length; k++) (leaders.children[k] as SVGPathElement).style.display = 'none';
  wanted.length = 0;
}

export function drawEffects(view: CommanderView, now: number) {
  let tags = 0;
  for (const e of view.effects ?? []) {
    if (e.asset === 'missile') continue; // #99: layers/missile.ts draws its marker, ring and line
    if (e.asset === 'gunship') {
      // layers/gunship.ts draws its focus mark; here the label beside it, to its own Commander, until it turns for home
      if (e.left > 0 && e.side === view.side) label(tags++, e, FOCUS_MARK_PX + 4, -18, tag(e.asset), e.phase === 'inbound' ? 'INBOUND' : clock(Math.ceil(e.left)), css(sideColor(e.side)));
      continue;
    }
    if (e.asset === 'drone' || e.asset === 'recon') {
      // #139: layers/drone.ts and layers/recon.ts draw them; here the label, to its own Commander, while it flies: by the drone's impact mark, by the Recon Plane itself
      if (e.side !== view.side || !e.craft || e.lost) continue;
      if (e.asset === 'drone') label(tags++, e, FOCUS_MARK_PX + 4, -18, tag(e.asset), `IMPACT ${clock(Math.ceil(e.impactIn))}`, css(sideColor(e.side)));
      else label(tags++, e.craft, 22, -34, tag(e.asset), clock(Math.ceil(e.left)), css(sideColor(e.side)));
      continue;
    }
    if (e.asset === 'beacon') {
      // #142: layers/beacon.ts draws the case, its lamp and the deny ring; here the label, to its own Commander, hostile while the beacon is silenced
      if (e.side !== view.side) continue;
      const time = e.landsIn ? `LANDS ${clock(Math.ceil(e.landsIn))}` : e.contested ? 'CONTESTED' : clock(Math.ceil(e.left));
      label(tags++, { x: e.x + 6, y: e.y + 6 }, 6, -18, tag(e.asset), time, css(e.contested ? COLOR.hostile : COLOR.friendly));
      continue;
    }
    if (e.asset === 'emp' || e.asset === 'feint') {
      // #143: layers/emp.ts and layers/feint.ts draw them; here the label, to its own Commander: the EMP's by its mark, counting to the burst and then its hold, the dummy's by it, counting to its landing and then its noise
      if (e.side !== view.side) continue;
      if (e.asset === 'emp') label(tags++, e, FOCUS_MARK_PX + 4, -18, tag(e.asset), e.burst === undefined ? `IMPACT ${clock(Math.ceil(e.impactIn))}` : clock(Math.ceil(e.left)), css(COLOR.friendly));
      else label(tags++, { x: e.x + 6, y: e.y + 6 }, 6, -18, tag(e.asset), e.landsIn ? `LANDS ${clock(Math.ceil(e.landsIn))}` : clock(Math.ceil(e.left)), css(COLOR.friendly));
      continue;
    }
    if (e.asset === 'smoke' || e.asset === 'creep') {
      // the strip until the last shell is down (the enemy's Creeping Barrage has none: only its shells show); the label to its own Commander
      const falling = !!e.impactIn || !!e.shells.length;
      const color = e.asset === 'creep' && e.side === view.side ? COLOR.hostile : sideColor(e.side); // the Creeping Barrage is a danger zone to its own Side too, as the Barrage's ring
      if (e.line && falling) stripAt(e, e.line.to, e.line.width, color, 0.06);
      if (e.line && e.side === view.side) label(tags++, e.line.to, 8, -18, tag(e.asset), e.impactIn ? `IMPACT ${clock(Math.ceil(e.impactIn))}` : clock(Math.ceil(e.left)), css(color));
      continue;
    }
    const danger = e.asset === 'barrage';
    const r = ringAt(e, e.radius, danger ? COLOR.hostile : COLOR.friendly, 0.06);
    r.ring.mesh.rotation.z = (now / 1000) * (danger ? RING_TURN_RAD_PER_S : e.asset === 'scan' ? SCAN_TURN_RAD_PER_S : 0);
    if (danger) r.ring.alpha.value = 0.7 + 0.3 * Math.max(0, 1 - (now - lastImpactAt('barrage')) / RING_PULSE_MS);
    let time = clock(Math.ceil(e.left));
    if (e.asset === 'supply' && e.fall) { // a Supply Drop crate: its ring brightens as it comes down
      const high = e.landsIn / e.fall;
      r.ring.alpha.value = 0.35 + 0.5 * (1 - high);
      if (high) time = `LANDS ${clock(Math.ceil(e.landsIn))}`;
    }
    if (e.asset === 'barrage' && e.impactIn) time = `IMPACT ${clock(Math.ceil(e.impactIn))}`; // the Barrage counts down to its first shell
    label(tags++, { x: e.x + e.radius * 0.72, y: e.y + e.radius * 0.72 }, 6, -18, tag(e.asset), time, css(danger ? COLOR.hostile : COLOR.friendly));
  }
  const at = targeting.armed && (targeting.spot ?? targeting.pointer);
  const radius = targeting.armed && view.assets?.find((a) => a.asset === targeting.armed)?.radius;
  if (at && radius) {
    const line = strip(targeting.pointer); // #138: once its start is pinned, a line-shaped Asset previews its strip towards the pointer, then the pinned direction
    const color = validSpot(at) && line?.ok !== false ? COLOR.bone : COLOR.hostile;
    const mark = targeting.armed === 'gunship'; // #101: its focus is a spot, not an area: layers/gunship.ts draws the mark
    if (line) stripAt(line.from, line.to, line.width, color, targeting.aim ? 0.12 : 0.06);
    if (!mark) ringAt(at, radius, color, targeting.spot ? 0.12 : 0.06);
    const edge = mark ? at : { x: at.x + radius * 0.72, y: at.y + radius * 0.72 };
    const dx = mark ? FOCUS_MARK_PX + 4 : 6;
    const g = session.host?.map.grid;
    label(tags++, edge, dx, -18, tag(targeting.armed!), g ? gridRef(g, at) : '', css(color));
    const near = nearestSquad(view, at);
    if (near) label(tags++, edge, dx, 2, near.name.toUpperCase(), `${Math.round(near.d)} M`, css(color));
  }
  rings.end();
  strips.end();
  for (let i = tags; i < labels.length; i++) labels[i]!.hidden = true;
  dockTags();
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
export const hideEffectLabels = () => {
  labels.forEach((el) => (el.hidden = true));
  dockTags(); // none asked for: every leader line goes too
};
