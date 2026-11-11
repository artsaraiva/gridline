// Per-tick cost of the Simulation on the Kaltenbach bake, in Node. Run with `pnpm bench`. Budgets: 5 ms at 12v12, 15 ms at 32v32.
// #151: and the flow fields' warm-up, memory and one crate's build, on Kaltenbach and on a 2.5 km map.
import { KALTENBACH } from './kaltenbach';
import { commanderView, commanderEvents, createMatch, step, warmFlows } from '../src/sim';
import { crateFlow, flowBytes } from '../src/sim/ai/flow';
import { DEFAULT_TUNE } from '../src/sim/tune';
import type { MapData } from '../src/sim/types';

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

export interface FlowStats { label: string; warmMs: number; flowMB: number; crateMs: number; warmBudgetMs: number; mbBudget?: number }

/** #151: building every flow field at match start, the memory they and the build buffers take, and one Supply Drop crate's field built mid-match (budget: one tick), after one run to settle the JIT. */
export function benchFlows(o: { label: string; map: MapData; warmBudgetMs: number; mbBudget?: number }): FlowStats {
  const run = () => {
    const m = createMatch({ seed: 1, map: o.map, tune: DEFAULT_TUNE, squadsPerSide: 8, commanderSide: 'nato' });
    let t = performance.now();
    warmFlows(m);
    const warmMs = performance.now() - t;
    const flowMB = flowBytes(m) / 1e6;
    t = performance.now();
    crateFlow(m, m.points[0]!);
    return { warmMs, flowMB, crateMs: performance.now() - t };
  };
  run();
  return { label: o.label, ...run(), warmBudgetMs: o.warmBudgetMs, mbBudget: o.mbBudget };
}

export const CRATE_BUDGET_MS = 1000 / DEFAULT_TUNE.hz;

export function reportFlows(rows: FlowStats[]): string {
  const f = (x: number) => x.toFixed(1).padStart(10);
  const ok = (v: number, budget?: number) => (budget === undefined ? '-' : v <= budget ? 'ok' : 'OVER');
  return [
    'flow fields     warm-up ms  memory MB   crate ms  budget (warm-up / memory / crate)',
    ...rows.map((r) => `${r.label.padEnd(14)} ${f(r.warmMs)} ${f(r.flowMB)} ${f(r.crateMs)}  ${r.warmBudgetMs} ms ${ok(r.warmMs, r.warmBudgetMs)} / ${r.mbBudget ?? '-'} MB ${ok(r.flowMB, r.mbBudget)} / ${CRATE_BUDGET_MS} ms ${ok(r.crateMs, CRATE_BUDGET_MS)}`),
  ].join('\n');
}
