// #183: the kind table is built on first use (core.ts `kinds`), so whichever vehicle module is imported first, as a test or a
// page may (#142: the review page failed on that), a Match still builds and steps exactly as it does when index.ts loads first.
// Nothing from the Simulation is imported statically here: each case loads its modules afresh, in its own order.
import { describe, expect, it, vi } from 'vitest';

const MODULES = import.meta.glob(['./*.ts', '!./*.test.ts']);
const TICKS = 200;

/** A Match on the test field with every Vehicle kind (a tank, jeeps, a helicopter, a jet and an AA a Side), stepped `TICKS` ticks after `first` loaded: its state hash and both Sides' views. */
async function run(first?: () => Promise<unknown>) {
  vi.resetModules();
  await first?.();
  const { commanderView, createMatch, stateHash, step } = await import('../index');
  const { DEFAULT_TUNE } = await import('../tune');
  const { TEST_FIELD } = await import('../../maps/test-field');
  const m = createMatch({ seed: 3, map: TEST_FIELD, tune: DEFAULT_TUNE, squadsPerSide: 4, commanderSide: 'nato' });
  for (let i = 0; i < TICKS; i++) step(m, []);
  return { hash: stateHash(m), views: JSON.stringify([commanderView(m, 'nato'), commanderView(m, 'pact')]) };
}

describe('#183 vehicle modules load in any order', () => {
  it('finds the kind modules', () => {
    expect(Object.keys(MODULES)).toEqual(expect.arrayContaining(['./tank.ts', './jeep.ts', './aa.ts', './helicopter.ts', './jet.ts', './lent.ts', './core.ts']));
  });

  it('steps the same Match whichever vehicle module is imported first', async () => {
    const plain = await run();
    expect(plain.views).toContain('"kind":"jet"'); // every kind is on the field
    for (const [path, load] of Object.entries(MODULES)) expect(await run(load), `${path} first`).toEqual(plain);
  }, 60_000);
});
