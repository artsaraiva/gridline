// Capture Points and HQs as APP-6 badges: the holder's frame (friendly rectangle, hostile diamond, neutral circle)
// with the letter inside, a capture arc toward whichever Side the meter favours, and a dashed ring at the radius.
import * as THREE from 'three/webgpu';
import type { MapData, PointView, SideId } from '../../sim/types';
import { COLOR, layer, sideColor } from '../renderer';
import { session } from '../session';
import { css, dashedRing, fading, frameFill, frameOutline, label, px, shade, type Frame } from './symbols';

const HALF = px(15);
const STROKE = px(2);
const ARC_R = px(20);

const frameOf = (s: SideId | null): Frame => (s === null ? 'neutral' : s === session.commanderSide ? 'friendly' : 'hostile');

/** A badge group (fill, halo, frame, letter) plus a way to show a holder. */
function badge(letter: string) {
  const group = new THREE.Group();
  const fill = new THREE.Mesh(frameFill('neutral', HALF), shade(COLOR.ink, 0.62));
  const halo = new THREE.Mesh(frameOutline('neutral', HALF, px(4)), shade(0x000000, 0.6));
  const outline = new THREE.Mesh(frameOutline('neutral', HALF, STROKE), fading(COLOR.bone));
  halo.position.z = 0.01;
  outline.position.z = 0.02;
  group.add(fill, halo, outline);
  const letters = new Map<number, THREE.Mesh>();
  let holder: SideId | null | undefined;
  return {
    group,
    hold(s: SideId | null) {
      if (s === holder) return;
      holder = s;
      const frame = frameOf(s);
      for (const [mesh, geometry] of [
        [fill, frameFill(frame, HALF)],
        [halo, frameOutline(frame, HALF, px(4))],
        [outline, frameOutline(frame, HALF, STROKE)],
      ] as const) {
        mesh.geometry.dispose();
        mesh.geometry = geometry;
      }
      const color = sideColor(s);
      (outline.material as THREE.MeshBasicNodeMaterial).color.setHex(color);
      for (const l of letters.values()) l.visible = false;
      let text = letters.get(color);
      if (!text) {
        text = label(letter, css(color), { size: letter.length > 1 ? 12 : 16 });
        text.position.z = 0.03;
        group.add(text);
        letters.set(color, text);
      }
      text.visible = true;
    },
  };
}

type PointMarks = { badge: ReturnType<typeof badge>; ring: ReturnType<typeof dashedRing>; arc: THREE.Mesh; progress: number };
const points = new Map<string, PointMarks>();
const hqs: ReturnType<typeof badge>[] = [];

export const resetPoints = () => {
  points.clear();
  hqs.length = 0;
};

/** `scale` is the symbol unit in metres. */
export function drawPoint(p: PointView, scale: number) {
  let r = points.get(p.id);
  if (!r) {
    r = { badge: badge(p.id), ring: dashedRing(p.radius, COLOR.bone), arc: new THREE.Mesh(new THREE.BufferGeometry(), fading(COLOR.bone)), progress: NaN };
    r.ring.mesh.position.set(p.x, p.y, 0.2);
    r.badge.group.position.set(p.x, p.y, 0.3);
    r.arc.position.z = 0.04;
    r.badge.group.add(r.arc);
    layer.add(r.ring.mesh, r.badge.group);
    points.set(p.id, r);
  }
  r.badge.group.scale.setScalar(scale);
  r.badge.hold(p.owner);
  r.ring.tint.value.setHex(sideColor(p.owner));
  if (p.progress === r.progress) return;
  r.progress = p.progress;
  r.arc.geometry.dispose();
  r.arc.geometry = new THREE.RingGeometry(ARC_R - px(1.5), ARC_R + px(1.5), 48, 1, Math.PI / 2, -Math.abs(p.progress) * Math.PI * 2);
  (r.arc.material as THREE.MeshBasicNodeMaterial).color.setHex(sideColor(p.progress > 0 ? 'nato' : 'pact'));
}

/** Both HQ badges. */
export function drawHqs(map: MapData, scale: number) {
  if (!hqs.length) {
    for (const side of ['nato', 'pact'] as const) {
      const b = badge('HQ');
      b.hold(side);
      b.group.position.set(map.hqs[side].x, map.hqs[side].y, 0.3);
      layer.add(b.group);
      hqs.push(b);
    }
  }
  for (const b of hqs) b.group.scale.setScalar(scale);
}
