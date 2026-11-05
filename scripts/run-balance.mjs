// Usage: pnpm balance [--seeds 10] [--first 1] [--squads 3] [--map kaltenbach|river|test]   TUNE='{"hitChance":0.3}' pnpm balance
// Loaded through vite because the sim imports extensionless TypeScript, which Node cannot run on its own.
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { balance, report, MAPS } = await server.ssrLoadModule('/scripts/balance.ts');
  const map = MAPS[args.map ?? 'kaltenbach'];
  if (!map) throw new Error(`unknown map "${args.map}", use one of ${Object.keys(MAPS).join(', ')}`);
  const tune = process.env.TUNE ? JSON.parse(process.env.TUNE) : undefined;
  console.log(report(balance({ seeds: Number(args.seeds ?? 10), firstSeed: Number(args.first ?? 1), squads: Number(args.squads ?? 4), map, tune })));
} finally {
  await server.close();
}
