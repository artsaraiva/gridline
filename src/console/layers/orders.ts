// Orders on the map (#36): a line from each ordered Squad's Squad Leader to its point, and DOM tags: the Squad letter
// beside the Squad Leader (#68: `leader` in the view, Wounded or not; #54: while the leader is dead, on the point man, the
// first alive member, else any present member; none once wiped), amber when selected, red while a member is Suppressed
// (#92, as BF4 Commander: the full tag made the map too busy, the card and the rail carry the rest). Line (#95, as BF4
// Commander): white dots, fainter while pending, amber with a reason glyph while Delayed.
import * as THREE from 'three/webgpu';
import type { CommanderView, Vec2 } from '../../sim/types';
import { BRIGHT, COLOR, GLOW, layer, toScreen } from '../renderer';
import { leaderOf } from '../summary';
import { targeting } from '../targeting';
import { css } from './symbols';

export const AMBER = COLOR.amber;
const MAX_DASHES = 300;
const DASH_PX = 3;
const GAP_PX = 6;
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
  for (const q of view.squads) {
    const lead = leaderOf(view, q) ?? view.friendlies.find((f) => f.squad === q.id && f.state === 'alive') ?? view.friendlies.find((f) => f.squad === q.id);
    const point = q.order?.point ? view.points.find((p) => p.id === q.order!.point) : undefined;
    const line = lineFor(q.id);
    const o = q.order;
    const there = lead && point && (lead.x - point.x) ** 2 + (lead.y - point.y) ** 2 < point.radius ** 2;
    line.visible = !!(lead && point && o && !(o.state === 'holding' && there));
    if (lead && point && o) {
      const m = line.material as THREE.LineBasicNodeMaterial;
      m.color.setHex(o.state === 'delayed' ? AMBER : COLOR.bone);
      m.opacity = o.state === 'pending' ? 0.45 : 0.9;
      segments(line, lead, point, DASH_PX * px, GAP_PX * px);
      if (o.state === 'delayed') tag(n++, { x: (lead.x + point.x) / 2, y: (lead.y + point.y) / 2 }, 6, -8, GLYPH[o.reason ?? 'retreat'], css(AMBER));
    }
    if (lead) {
      const suppressed = view.friendlies.some((f) => f.squad === q.id && f.suppressed);
      tag(n++, lead, -30, -22, q.name[0]!, css(targeting.selected === q.id ? AMBER : suppressed ? COLOR.hostile : COLOR.bone));
    }
  }
  for (let i = n; i < tags.length; i++) tags[i]!.hidden = true;
}

/** Hides every tag (between matches). */
export const hideOrderTags = () => tags.forEach((el) => (el.hidden = true));
