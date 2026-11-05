// The feed's post chain, all TSL: symbology glow, chromatic fringe, then always-on VHS (grain, scanlines, roll bar,
// vignette) with rare static bursts that split RGB wider and tear rows. Call `burst(k)` on a big moment.
import * as THREE from 'three/webgpu';
import { float, floor, fract, mix, mrt, output, pass, rand, renderOutput, screenSize, screenUV, smoothstep, step, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { scanlines, vignette } from 'three/addons/tsl/display/CRT.js';
import { glitchScheduler } from './glitch';
import { camera, renderer, scene } from './renderer';

const glitch = uniform(0); // current burst strength, 0..1

const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, glow: float(0) })); // `flat` materials write glow 1
const frame = scenePass.getTextureNode('output');
const glowMask = scenePass.getTextureNode('glow');

// torn rows: during a burst some 1/180-screen rows slide sideways, re-rolled 30 times a second
const tick = floor(time.mul(30));
const row = floor(screenUV.y.mul(180));
const tear = rand(vec2(row, tick)).sub(0.5).mul(0.03).mul(glitch).mul(step(0.7, rand(vec2(row.mul(0.37), tick))));
const uv = screenUV.add(vec2(tear, 0));
// chromatic fringe: 1 px always, up to 7 px in a burst
const ca = float(1).add(glitch.mul(6)).div(screenSize.x);
const split = vec3(frame.sample(uv.add(vec2(ca, 0))).r, frame.sample(uv).g, frame.sample(uv.sub(vec2(ca, 0))).b);
const glow = bloom(frame.mul(glowMask.r), 0.7, 0.35, 0);
// VHS works in display space, like the prototype's CSS overlays
const display = renderOutput(vec4(split.add(glow.rgb), 1)).rgb;

const grain = rand(screenUV.add(fract(time))).sub(0.5).mul(0.07);
const scanned = scanlines(display.add(grain), float(0.3), screenSize.y.mul((Math.PI * 2) / (3 * devicePixelRatio))); // dark line every 3 px
const roll = fract(screenUV.y.add(time.div(7))); // a soft bright band crossing the screen every 7 s
const bar = smoothstep(0.82, 0.91, roll).mul(float(1).sub(smoothstep(0.91, 1, roll)));
const rolled = scanned.add(vec3(0.63, 0.86, 1).mul(bar.mul(0.08)));
// static: coarse noise screened on, flickering with the burst
const snow = rand(floor(screenUV.mul(screenSize).div(2)).add(fract(time.mul(7)))).mul(glitch).mul(step(0.35, rand(vec2(tick, 1.7))));
const withStatic = mix(rolled, vec3(1), snow.mul(0.45));
const feed = vignette(withStatic, float(0.7), float(0.6));

const pipeline = new THREE.RenderPipeline(renderer, vec4(feed, 1));
pipeline.outputColorTransform = false; // renderOutput above already did it

const scheduler = glitchScheduler(Math.random);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // no flashing static
let last = performance.now();

/** Starts a static burst of strength `k` (0..1) unless one ran in the last 4 s. */
export const burst = (k: number) => !calm && scheduler.burst(performance.now(), k);

/** Renders the scene through the feed chain. */
export function renderFeed() {
  const now = performance.now();
  if (!calm) scheduler.frame(now, now - last);
  last = now;
  glitch.value = scheduler.level(now);
  pipeline.render();
}
