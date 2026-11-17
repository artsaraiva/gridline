// The feed's post chain, all TSL: symbology glow, a lens's chromatic fringe toward the corners, then a little grain and a
// soft vignette, with rare static bursts that split RGB wider and tear rows. Zoom and a confirmed Asset throw a burst;
// call `burst(k)` on other big moments (#38: pan to a Callout).
import * as THREE from 'three/webgpu';
import { float, floor, fract, mix, mrt, output, pass, rand, renderOutput, screenSize, screenUV, step, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { vignette } from 'three/addons/tsl/display/CRT.js';
import { glitchScheduler } from './glitch';
import { camera, renderer, scene } from './renderer';
import { confirmed } from './targeting';

const glitch = uniform(0); // current burst strength, 0..1

const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, glow: float(0) })); // materials with `GLOW` write their alpha
const frame = scenePass.getTextureNode('output');
const glowMask = scenePass.getTextureNode('glow');

// torn rows: during a burst some 1/180-screen rows slide sideways, re-rolled 30 times a second
const tick = floor(time.mul(30));
const row = floor(screenUV.y.mul(180));
const tear = rand(vec2(row, tick)).sub(0.5).mul(0.03).mul(glitch).mul(step(0.7, rand(vec2(row.mul(0.37), tick))));
const uv = screenUV.add(vec2(tear, 0));
// chromatic fringe, as a lens gives it: none at the centre, 1.2 px out at the corners, up to 7 px anywhere in a burst
const edge = screenUV.sub(0.5).length().mul(1.414);
const ca = edge.mul(edge).mul(1.2).add(glitch.mul(6)).div(screenSize.x);
const split = vec3(frame.sample(uv.add(vec2(ca, 0))).r, frame.sample(uv).g, frame.sample(uv.sub(vec2(ca, 0))).b);
const glow = bloom(frame.mul(glowMask.r), 0.7, 0.35, 0);
// VHS works in display space, like the prototype's CSS overlays
const display = renderOutput(vec4(split.add(glow.rgb), 1)).rgb;

// a clean picture at rest: a little grain and a soft vignette, no scanlines and no roll bar; the wear shows only in a burst
const grained = display.add(rand(screenUV.add(fract(time))).sub(0.5).mul(0.035));
// static: coarse noise screened on, flickering with the burst
const snow = rand(floor(screenUV.mul(screenSize).div(2)).add(fract(time.mul(7)))).mul(glitch).mul(step(0.35, rand(vec2(tick, 1.7))));
const exposure = uniform(0); // a blast's over-exposure, 0..1, warm
const withStatic = mix(grained, vec3(1), snow.mul(0.45)).add(vec3(1, 0.94, 0.82).mul(exposure));
const feed = vignette(withStatic, float(0.5), float(0.6));

const pipeline = new THREE.RenderPipeline(renderer, vec4(feed, 1));
pipeline.outputColorTransform = false; // renderOutput above already did it

const scheduler = glitchScheduler(Math.random);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // no flashing static
let last = performance.now();

/** Starts a static burst of strength `k` (0..1) unless one ran in the last 15 s (#91). */
export const burst = (k: number) => !calm && scheduler.burst(performance.now(), k);
confirmed.push(() => burst(0.4));

/** A flare is gone this long after it starts. */
const FLARE_MS = 120;
let flared = { at: -Infinity, k: 0 };
/** Over-exposes the whole feed by `k` (0..1) for a moment: a Cruise Missile's hit. */
export const flare = (k: number) => {
  if (!calm) flared = { at: performance.now(), k };
};

/** Renders the scene through the feed chain. */
export function renderFeed() {
  const now = performance.now();
  if (!calm) scheduler.frame(now, now - last);
  last = now;
  glitch.value = scheduler.level(now);
  exposure.value = flared.k * Math.max(0, 1 - (now - flared.at) / FLARE_MS);
  pipeline.render();
}
