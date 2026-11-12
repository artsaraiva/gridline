// Usage: pnpm bench [--seconds 900] [--flows 1 (flow fields only)]   Loaded through vite for the same reason as run-balance.mjs.
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { benchTicks, reportTicks, benchFlows, reportFlows } = await server.ssrLoadModule('/scripts/bench-tick.ts');
  const { bake, KALTENBACH } = await server.ssrLoadModule('/scripts/bakes.ts');
  const AUENTAL = bake('auental');
  console.log(reportFlows([
    benchFlows({ label: 'Kaltenbach', map: KALTENBACH, warmBudgetMs: 680 }), // #151: as fast as before it (measured 680 ms)
    benchFlows({ label: 'Auental', map: AUENTAL, warmBudgetMs: 6000, mbBudget: 160 }), // #151
  ]));
  const seconds = Number(args.seconds ?? 900);
  if (!args.flows)
    console.log(reportTicks([
      benchTicks({ label: 'Kaltenbach 12v12', map: KALTENBACH, squads: 3, budgetMs: 5, seconds }),
      benchTicks({ label: 'Kaltenbach 32v32', map: KALTENBACH, squads: 8, budgetMs: 15, seconds }),
      benchTicks({ label: 'Auental 32v32', map: AUENTAL, squads: 8, budgetMs: 15, seconds }), // #150: as many Soldiers as Kaltenbach's, so the same budget
    ]));
} finally {
  await server.close();
}
