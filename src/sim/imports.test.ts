/// <reference types="node" />
// #183: the Vehicle rules sit behind one seam. No import cycle runs through vehicles/ (a cycle may stay inside the folder,
// where the kind table is built on first use: see vehicles/load-order.test.ts), and vehicles/ imports nothing from the Assets,
// combat.ts or damage.ts. Type-only imports are left out: they are gone at run time.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SIM = dirname(fileURLToPath(import.meta.url));

/** Every Simulation module, by its path under src/sim (tests left out). */
function modules(dir = SIM): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return modules(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [relative(SIM, p)] : [];
  });
}

/** The modules under src/sim that `file` imports a value from (an `import` or `export ... from` that is not `type` only). */
function imports(file: string): string[] {
  const src = readFileSync(join(SIM, file), 'utf8');
  return [...src.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?'(\.[^']+)'/gm)].flatMap(([, type, spec]) => {
    if (type) return [];
    const base = resolve(SIM, dirname(file), spec!);
    const hit = [`${base}.ts`, join(base, 'index.ts')].find((p) => existsSync(p));
    return hit && !relative(SIM, hit).startsWith('..') ? [relative(SIM, hit)] : [];
  });
}

const inVehicles = (f: string) => f.startsWith('vehicles/');
const graph = new Map(modules().map((f) => [f, imports(f)]));

/** The import cycles of the graph: its strongly connected components of more than one module (Tarjan's). */
function cycles(): string[][] {
  let n = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const out: string[][] = [];
  const visit = (v: string) => {
    index.set(v, n);
    low.set(v, n++);
    stack.push(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (stack.includes(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    const scc: string[] = [];
    let w: string;
    do scc.push((w = stack.pop()!));
    while (w !== v);
    if (scc.length > 1) out.push(scc.sort());
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return out;
}

describe('#183 the Vehicle rules behind one seam', () => {
  it('reads every module, the vehicles folder included', () => {
    expect([...graph.keys()].filter(inVehicles)).toEqual(expect.arrayContaining(['vehicles/core.ts', 'vehicles/body.ts', 'vehicles/tank.ts']));
    expect(graph.get('vehicles/core.ts')).toContain('vehicles/body.ts');
  });

  it('runs no import cycle through vehicles/: a cycle with a vehicles module in it stays inside the folder', () => {
    const crossing = cycles().filter((c) => c.some(inVehicles) && !c.every(inVehicles));
    expect(crossing).toEqual([]);
  });

  it('imports nothing into vehicles/ from the Assets, combat.ts or damage.ts', () => {
    const banned = (f: string) => f.startsWith('assets/') || f === 'combat.ts' || f === 'damage.ts';
    const found = [...graph].flatMap(([f, to]) => (inVehicles(f) ? to.filter(banned).map((t) => `${f} -> ${t}`) : []));
    expect(found).toEqual([]);
  });
});
