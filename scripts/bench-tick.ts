// Per-tick cost of the Simulation on the Kaltenbach bake, in Node. Run with `pnpm bench`. Budgets: 5 ms at 12v12, 15 ms at 32v32.
import { KALTENBACH } from './kaltenbach';
import { commanderView, commanderEvents, createMatch, step, warmFlows } from '../src/sim';
import { DEFAULT_TUNE } from '../src/sim/tune';

export interface TickStats { label: string; ticks: number; meanMs: number; p95Ms: number; maxMs: number; warmMs: number; budgetMs: number }

/** Times the worker's whole per-tick work (step + view + events; flow fields are warmed first and timed apart) over `seconds` of match time, after one warm-up match to settle the JIT. */
export function benchTicks(o: { label: string; squads: number; budgetMs: number; seconds?: number; seed?: number }): TickStats {
  let warm = 0;
  const run = (record: boolean) => {
    const m = createMatch({ seed: o.seed ?? 1, map: KALTENBACH, tune: DEFAULT_TUNE, squadsPerSide: o.squads, commanderSide: 'nato' });
    const w = performance.now();
    warmFlows(m); // the worker does this once at match start, before the first tick
    if (record) warm = performance.now() - w;
    const ms: number[] = [];
    const n = (o.seconds ?? 900) * DEFAULT_TUNE.hz;
    for (let i = 0; i < n && !m.result; i++) {
      const t = performance.now();
      const ev = step(m, []);
      commanderView(m, 'nato');
      commanderEvents(m, 'nato', ev);
      if (record) ms.push(performance.now() - t);
    }
    return ms;
  };
  run(false);
  const ms = run(true);
  const sorted = [...ms].sort((a, b) => a - b);
  return {
    label: o.label,
    ticks: ms.length,
    meanMs: ms.reduce((a, b) => a + b, 0) / ms.length,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)]!,
    maxMs: sorted.at(-1)!,
    warmMs: warm,
    budgetMs: o.budgetMs,
  };
}

export function reportTicks(rows: TickStats[]): string {
  const f = (x: number) => x.toFixed(2).padStart(7);
  return [
    'scenario        ticks  mean ms   p95 ms   max ms  warm-up ms  budget (mean / p95)',
    ...rows.map((r) => `${r.label.padEnd(12)} ${String(r.ticks).padStart(8)} ${f(r.meanMs)}  ${f(r.p95Ms)} ${f(r.maxMs)}  ${f(r.warmMs)}   ${r.budgetMs} ms  ${r.p95Ms < r.budgetMs ? 'ok' : 'OVER'}`),
  ].join('\n');
}
