// Usage: pnpm bench [--seconds 900]   Loaded through vite for the same reason as run-balance.mjs.
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { benchTicks, reportTicks } = await server.ssrLoadModule('/scripts/bench-tick.ts');
  const seconds = Number(args.seconds ?? 900);
  console.log(reportTicks([
    benchTicks({ label: '12v12', squads: 3, budgetMs: 5, seconds }),
    benchTicks({ label: '32v32', squads: 8, budgetMs: 15, seconds }),
  ]));
} finally {
  await server.close();
}
