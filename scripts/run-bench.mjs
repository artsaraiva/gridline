// Usage: pnpm bench [--seconds 900] [--flows 1 (flow fields only)]   Loaded through vite for the same reason as run-balance.mjs.
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { benchTicks, reportTicks, benchFlows, reportFlows } = await server.ssrLoadModule('/scripts/bench-tick.ts');
  const { KALTENBACH } = await server.ssrLoadModule('/scripts/kaltenbach.ts');
  const { AUENTAL_FIELD } = await server.ssrLoadModule('/src/maps/auental-field.ts');
  console.log(reportFlows([
    benchFlows({ label: 'Kaltenbach', map: KALTENBACH, warmBudgetMs: 680 }), // #151: as fast as before it (measured 680 ms)
    benchFlows({ label: 'Auental field', map: AUENTAL_FIELD, warmBudgetMs: 6000, mbBudget: 160 }), // #151; the greybox bake replaces the field once it exists (#150)
  ]));
  const seconds = Number(args.seconds ?? 900);
  if (!args.flows)
    console.log(reportTicks([
      benchTicks({ label: '12v12', squads: 3, budgetMs: 5, seconds }),
      benchTicks({ label: '32v32', squads: 8, budgetMs: 15, seconds }),
    ]));
} finally {
  await server.close();
}
