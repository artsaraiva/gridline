// Orders on the map (#36): a line from each ordered Squad's leader to its point, and DOM tags: the Squad tag on the leader
// (name, strength, task, Order state, alerts) beside layers/squads.ts's APP-6 frame, and a Holding tag on the point. Line:
// solid while Following, amber dashed with a reason glyph while Delayed, faint dashes while pending.
import * as THREE from 'three/webgpu';
import type { CommanderView, FriendlyView, Vec2 } from '../../sim/types';
import { BRIGHT, COLOR, GLOW, layer, toScreen } from '../renderer';
import { squadTag } from '../summary';
import { targeting } from '../targeting';
import { css } from './symbols';

export const AMBER = COLOR.amber;
const MAX_DASHES = 300;
const DASH_PX = 7;
const GAP_PX = 5;
const GLYPH = { retreat: '↩ RETREATING', resupply: '⟲ RESUPPLYING' };

const lines = new Map<number, THREE.LineSegments>();
const labelBox = document.getElementById('labels')!;
const tags: HTMLElement[] = [];

export function resetOrders() {
  lines.clear();
  tags.length = 0;
}

function lineFor(id: number) {
  let l = lines.get(id);
  if (!l) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DASHES * 6), 3));
    const m = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.opacityNode = BRIGHT;
    m.mrtNode = GLOW();
    l = new THREE.LineSegments(g, m);
    l.frustumCulled = false;
    layer.add(l);
    lines.set(id, l);
  }
  return l;
}

/** Sets `l` to the segment a→b, solid or cut into dashes `dash` and `gap` metres long. */
function segments(l: THREE.LineSegments, a: Vec2, b: Vec2, dash: number, gap: number) {
  const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
  const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1;
  const step = Math.max(dash + gap, len / MAX_DASHES); // never more than MAX_DASHES: far zoom-ins just get longer dashes
  const k = dash / (dash + gap);
  let n = 0;
  for (let d = 0; d < len && n < MAX_DASHES; d += step, n++) {
    const e = Math.min(len, d + step * k);
    pos.setXYZ(2 * n, a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len, 0.6);
    pos.setXYZ(2 * n + 1, a.x + ((b.x - a.x) * e) / len, a.y + ((b.y - a.y) * e) / len, 0.6);
  }
  pos.needsUpdate = true;
  l.geometry.setDrawRange(0, 2 * n);
}

function tag(i: number, p: Vec2, dx: number, dy: number, text: string, color: string) {
  let el = tags[i];
  if (!el) el = tags[i] = labelBox.appendChild(document.createElement('span'));
  el.hidden = false;
  el.textContent = text;
  el.style.color = color;
  const s = toScreen(p);
  el.style.transform = `translate(${s.x + dx}px, ${s.y + dy}px)`;
}

/** `px` is world metres per screen pixel. */
export function drawOrders(view: CommanderView, px: number) {
  let n = 0;
  const leaders = new Map<number, FriendlyView>();
  for (const f of view.friendlies) if (f.state === 'alive' && !leaders.has(f.squad)) leaders.set(f.squad, f);
  for (const q of view.squads) {
    const lead = leaders.get(q.id);
    const point = q.order?.point ? view.points.find((p) => p.id === q.order!.point) : undefined;
    const line = lineFor(q.id);
    const o = q.order;
    const there = lead && point && (lead.x - point.x) ** 2 + (lead.y - point.y) ** 2 < point.radius ** 2;
    line.visible = !!(lead && point && o && !(o.state === 'holding' && there));
    if (lead && point && o) {
      const m = line.material as THREE.LineBasicNodeMaterial;
      m.color.setHex(o.state === 'delayed' ? AMBER : COLOR.friendly);
      m.opacity = o.state === 'pending' ? 0.55 : 0.85;
      if (o.state === 'following' || o.state === 'holding') segments(line, lead, point, 1e9, 0);
      else segments(line, lead, point, DASH_PX * px, GAP_PX * px);
      if (o.state === 'delayed') tag(n++, { x: (lead.x + point.x) / 2, y: (lead.y + point.y) / 2 }, 6, -8, GLYPH[o.reason ?? 'retreat'], css(AMBER));
      if (o.state === 'holding') tag(n++, point, 4, 6, `HOLD · ${q.name.toUpperCase()}`, css(COLOR.friendly));
    }
    if (lead) tag(n++, lead, 40, -30, squadTag(q, view.friendlies.some((f) => f.squad === q.id && f.suppressed)), css(targeting.selected === q.id ? AMBER : COLOR.friendly));
  }
  for (let i = n; i < tags.length; i++) tags[i]!.hidden = true;
}

/** Hides every tag (between matches). */
export const hideOrderTags = () => tags.forEach((el) => (el.hidden = true));
