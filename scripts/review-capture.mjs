// Usage: pnpm review:capture [--out dir] [--views barrage,scan,supply,gunship,smoke,creep,drone,recon,beacon,tank,jeep,helicopter,jet,aa,overview] [--seconds 15] [--every 500]
// Screenshots the DEV Asset review scene (#60) for a by-eye check of baked Assets: a timed burst per view, at a
// fixed 1440x900 CSS size, from its own dev server with file watching off so no reload interrupts a burst.
// Writes <out>/<view>-NN.png and <out>/console.txt (console warnings/errors and page errors).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const out = resolve(args.out ?? 'review-capture');
const views = (args.views ?? 'barrage,scan,supply,gunship,smoke,creep,drone,recon,beacon,tank,jeep,helicopter,jet,aa,overview').split(',');
const seconds = Number(args.seconds ?? 15);
const every = Number(args.every ?? 500);
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const log = [];
try {
  for (const view of views) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.on('console', (m) => ['warning', 'error'].includes(m.type()) && log.push(`[${view}] ${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => log.push(`[${view}] pageerror: ${e.message}`));
    await page.goto(`${base}dev-asset-review.html?focus=${view}`);
    await page.waitForFunction(() => document.body.dataset.reviewReady === 'true', null, { timeout: 60_000 });
    await page.waitForTimeout(1500); // shader compile, sheet upload
    const shots = Math.ceil((seconds * 1000) / every);
    for (let i = 0; i < shots; i++) {
      await page.screenshot({ path: join(out, `${view}-${String(i).padStart(2, '0')}.png`) });
      await page.waitForTimeout(every);
    }
    await page.close();
    console.log(`${view}: ${shots} frames`);
  }
} finally {
  writeFileSync(join(out, 'console.txt'), log.join('\n') + '\n');
  await browser.close();
  await server.close();
}
console.log(`wrote ${out}`);
