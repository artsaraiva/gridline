// Usage: pnpm preview (after pnpm build), then node scripts/measure-fps.mjs [--url http://localhost:4173/] [--squads 8] [--seconds 20] [--headed] [--bake 4096]
// Plays a match at 1366x768 and 1920x1080 and prints the frame rate (VHS is always on in the feed) and which backend drew it.
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), v.startsWith('--h') ? true : all[i + 1]]] : a), []));
const url = args.url ?? 'http://localhost:4173/';
const squads = args.squads ?? '8';
const seconds = Number(args.seconds ?? 20);
const browser = await chromium.launch({ headless: !args.headed });
console.log(`browser ${browser.version()}  ${args.headed ? 'headed' : 'headless'}  squads ${squads}`);
for (const [width, height] of [[1366, 768], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (m) => m.text().startsWith('map:') && console.log('  ', m.text()));
  page.on('pageerror', (e) => console.log('  pageerror', e.message));
  await page.goto(`${url}?squads=${squads}&seed=1${args.bake ? `&bake=${args.bake}` : ''}`);
  await page.click('#setup button[type=submit]');
  await page.waitForFunction(() => document.getElementById('setup')?.hidden || getComputedStyle(document.getElementById('setup')).display === 'none');
  await page.waitForTimeout(3000); // shader compile, texture upload
  const r = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const dts = [];
        let last = performance.now();
        const t0 = last;
        const f = (now) => {
          dts.push(now - last);
          last = now;
          if (now - t0 < ms) requestAnimationFrame(f);
          else resolve({ dts, webgl2: !!document.querySelector('canvas:not(#hud)').getContext('webgl2') });
        };
        requestAnimationFrame(f);
      }),
    seconds * 1000,
  );
  const s = [...r.dts].sort((a, b) => a - b);
  const mean = r.dts.reduce((a, b) => a + b, 0) / r.dts.length;
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const e = c?.getExtension('WEBGL_debug_renderer_info');
    return { gpu: e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a', max: c?.getParameter(c.MAX_TEXTURE_SIZE) };
  });
  console.log(`${width}x${height}  backend ${r.webgl2 ? 'WebGL 2' : 'WebGPU'}  fps mean ${(1000 / mean).toFixed(1)}  p95 frame ${s[Math.floor(s.length * 0.95)].toFixed(1)} ms  worst ${s.at(-1).toFixed(1)} ms  gpu "${gl.gpu}" MAX_TEXTURE_SIZE ${gl.max}`);
  await page.screenshot({ path: `${process.env.TMPDIR ?? '/tmp'}/fps-${width}.png` });
  await page.close();
}
await browser.close();
