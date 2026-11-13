// The Barrage's shells (#53, #61, #98): each in its visible window is a small baked round at the nearest heading with a
// thin bright streak back to its entry spot; after the hit the streak hangs in the air and fades. sprites/shell.ts
// says where everything is; the Console's own impacts say where shells landed. #138: the Creeping Barrage's shells are the
// same; the Smoke Screen's have a grey tail and no hit.
import * as THREE from 'three/webgpu';
import type { CommanderView, Vec2 } from '../../sim/types';
import { metresPerPx, pool } from '../renderer';
import { session } from '../session';
import { spriteMesh } from '../sprites/sheet';
import { barrageShells, SHELL_SHEET, shellStreak } from '../sprites/shell';
import { recentImpacts } from './impacts';
import { streak } from './symbols';

/** The streak is this wide on screen, whatever the zoom. */
const STREAK_PX = 2.5;
/** A shell's streak hangs in the air after the hit and fades out over this long. */
const STREAK_FADE_MS = 2500;

const quad = new THREE.PlaneGeometry(1, 1);
const bodies = pool(() => spriteMesh(SHELL_SHEET));
const streaks = pool(() => new THREE.Mesh(quad, streak()));
/** #138: a smoke shell's tail. */
const SMOKE_TAIL = 0x8f9694;
const greyStreaks = pool(() => new THREE.Mesh(quad, streak(SMOKE_TAIL)));

function streakAt(from: Vec2, to: Vec2, flight: number, opacity: number, grey = false) {
  const m = (grey ? greyStreaks : streaks).next();
  const t = shellStreak(from, to, flight);
  m.position.set((t.tail.x + t.head.x) / 2, (t.tail.y + t.head.y) / 2, 0.6);
  m.rotation.z = t.angle;
  m.scale.set(t.length, STREAK_PX * metresPerPx.value, 1);
  m.material.opacity = opacity;
}

export function drawShells(view: CommanderView, now: number) {
  const map = session.host?.map;
  if (map) {
    for (const s of barrageShells(view, map)) {
      streakAt(s.from, s.to, s.flight, 1, s.smoke);
      const b = bodies.next();
      b.position.set(s.x, s.y, 0.72);
      b.rotation.z = s.bodyRotation;
      b.scale.setScalar(s.size);
      b.frame.value = s.frame;
    }
    const hq = map.hqs[view.side];
    // sqrt: the glow curve squares it back to a steady fade
    for (const asset of ['barrage', 'creep'] as const)
      for (const i of recentImpacts(now, STREAK_FADE_MS, asset)) streakAt(hq, i, 1, Math.sqrt(1 - (now - i.at) / STREAK_FADE_MS));
  }
  bodies.end();
  streaks.end();
  greyStreaks.end();
}
