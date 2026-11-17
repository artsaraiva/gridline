// The Barrage's shells (#53, #61, #98): each in its visible window is a small baked round at the nearest heading with a
// shadow on the ground under it, closing in on where it will land, at the head of the trace it has left in the air all
// the way from its caller's HQ: faint while it is up and away, intensifying as it comes down; after the hit a short streak
// hangs in the air and fades. sprites/shell.ts says where everything is; the Console's own impacts say where shells
// landed. #138: the Creeping Barrage's shells are the same; the Smoke Screen's are grey and have no hit, so each bursts
// into a grey puff where it lands and its tail hangs longer.
import * as THREE from 'three/webgpu';
import type { CommanderView, Vec2 } from '../../sim/types';
import { COLOR, metresPerPx, pool } from '../renderer';
import { session } from '../session';
import { spriteMesh } from '../sprites/sheet';
import { barrageShells, SHELL_SHADOW_FRAME, SHELL_SHEET, SHELL_VISIBLE_FROM, shellStreak, shellTraces } from '../sprites/shell';
import { recentImpacts } from './impacts';
import { fading, soft, streak } from './symbols';

/** The streak is this wide on screen, whatever the zoom, and trails the shell by this much of its flight (a fifth of a second): a tail, not a line across the map. */
const STREAK_PX = 2.5;
const TAIL_FLIGHT = 0.05;
/** A shell's streak hangs in the air after the hit and fades out over this long; a smoke shell's, which has no blast to mark it, longer. */
const STREAK_FADE_MS = 1200;
const SMOKE_TAIL_FADE_MS = 5000;
/** A smoke shell bursts into a grey puff this many metres across over this long. */
const SMOKE_BURST = { ms: 1400, size: 26, opacity: 0.7 };
/** A shell's shadow is this dark as it lands, and half that when the shell first shows, high up. */
const SHADOW_OPACITY = 0.42;

const quad = new THREE.PlaneGeometry(1, 1);
const bodies = pool(() => spriteMesh(SHELL_SHEET));
const shadows = pool(() => spriteMesh(SHELL_SHEET, { frame: SHELL_SHADOW_FRAME, shadow: true, opacity: SHADOW_OPACITY }));
const streaks = pool(() => new THREE.Mesh(quad, streak()));
/** #138: a smoke shell's tail. */
const SMOKE_TAIL = 0x8f9694;
const greyStreaks = pool(() => new THREE.Mesh(quad, streak(SMOKE_TAIL)));
/** The stretches of the traces the shells in the air leave, from the battery to where each is now. */
const traces = pool(() => new THREE.Mesh(quad, fading(COLOR.bone)));
const greyTraces = pool(() => new THREE.Mesh(quad, fading(SMOKE_TAIL)));
const puffs = pool(() => new THREE.Mesh(quad, soft(0xa8aeac, { glow: false })));

/** The own Side's smoke shells seen in the air last frame, by landing spot: one that is missing now has just landed. */
let seen = new Map<string, { x: number; y: number }>();
/** The smoke shells' landings still showing, each with when it happened. */
let landed: { x: number; y: number; at: number }[] = [];

export const resetShells = () => {
  seen = new Map();
  landed = [];
};

function streakAt(from: Vec2, to: Vec2, flight: number, opacity: number, grey = false) {
  const m = (grey ? greyStreaks : streaks).next();
  const t = shellStreak(from, to, flight, TAIL_FLIGHT);
  m.position.set((t.tail.x + t.head.x) / 2, (t.tail.y + t.head.y) / 2, 0.6);
  m.rotation.z = t.angle;
  m.scale.set(t.length, STREAK_PX * metresPerPx.value, 1);
  m.material.opacity = opacity;
}

/** Notes the own Side's smoke shells that have just landed. */
function watch(view: CommanderView, now: number) {
  const next = new Map<string, { x: number; y: number }>();
  for (const e of view.effects ?? []) if (e.asset === 'smoke' && e.side === view.side) for (const s of e.shells) next.set(`${s.x}:${s.y}`, { x: s.x, y: s.y });
  for (const [key, s] of seen) if (!next.has(key)) landed.push({ ...s, at: now });
  seen = next;
}

export function drawShells(view: CommanderView, now: number) {
  const map = session.host?.map;
  if (map) {
    const hq = map.hqs[view.side];
    watch(view, now);
    for (const t of shellTraces(view, map)) {
      const m = (t.smoke ? greyTraces : traces).next();
      m.position.set((t.a.x + t.b.x) / 2, (t.a.y + t.b.y) / 2, 0.6);
      m.rotation.z = Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x);
      m.scale.set(Math.max(1e-3, Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y)), STREAK_PX * metresPerPx.value, 1);
      m.material.opacity = t.opacity;
    }
    for (const s of barrageShells(view, map)) {
      const fall = (s.flight - SHELL_VISIBLE_FROM) / (1 - SHELL_VISIBLE_FROM); // 0 as it first shows, 1 as it lands
      const shadow = shadows.next();
      shadow.position.set(s.ground.x, s.ground.y, 0.42);
      shadow.rotation.z = s.rotation;
      shadow.scale.setScalar(s.size);
      shadow.material.opacity = SHADOW_OPACITY * (0.5 + 0.5 * fall);
      const b = bodies.next();
      b.position.set(s.x, s.y, 0.72);
      b.rotation.z = s.bodyRotation;
      b.scale.setScalar(s.size);
      b.frame.value = s.frame;
    }
    // sqrt: the glow curve squares it back to a steady fade
    for (const asset of ['barrage', 'creep'] as const)
      for (const i of recentImpacts(now, STREAK_FADE_MS, asset)) streakAt(hq, i, 1, Math.sqrt(1 - (now - i.at) / STREAK_FADE_MS));

    landed = landed.filter((l) => now - l.at < SMOKE_TAIL_FADE_MS);
    for (const l of landed) {
      const age = now - l.at;
      streakAt(hq, l, 1, Math.sqrt(1 - age / SMOKE_TAIL_FADE_MS) * 0.8, true);
      const k = age / SMOKE_BURST.ms;
      if (k >= 1) continue;
      const p = puffs.next();
      p.position.set(l.x, l.y, 0.65);
      p.scale.setScalar(SMOKE_BURST.size * (0.3 + 0.7 * Math.sqrt(k)));
      p.material.opacity = SMOKE_BURST.opacity * (1 - k);
    }
  }
  for (const p of [bodies, shadows, streaks, greyStreaks, traces, greyTraces, puffs]) p.end();
}
