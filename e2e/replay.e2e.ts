// Determinism across engines: the same Match record replayed in each browser must hash the same, tick for tick, as in Node.
import { expect, test, type Page } from '@playwright/test';
import { readBake } from '../src/maps/bake-check';
import { terrainOf } from '../src/maps/load';
import { AUENTAL_RECORD, REPLAY_RECORD, REPLAY_TICKS, replayHashes } from '../src/host/replay';
import { DEFAULT_TUNE } from '../src/sim/tune';

/** The hashes replay.html computes in this browser, for the record its query names. */
const inBrowser = async (page: Page, query: string, timeout?: number) => {
  await page.goto(`/e2e/replay.html${query}`);
  return page.waitForFunction(() => (window as unknown as { hashes?: string[] }).hashes, undefined, { timeout }).then((h) => h.jsonValue() as Promise<string[]>);
};

const expectSame = (browser: string[], node: string[], browserName: string) => {
  expect(browser).toHaveLength(REPLAY_TICKS);
  const tick = browser.findIndex((h, i) => h !== node[i]);
  expect(tick, `${browserName} diverges from Node at tick ${tick}: ${browser[tick]} vs ${node[tick]}`).toBe(-1);
};

test('a replayed Match hashes the same in this browser as in Node', async ({ page, browserName }) => {
  const node = replayHashes(REPLAY_RECORD, REPLAY_TICKS);
  expect(REPLAY_RECORD.log.length).toBeGreaterThan(0);
  expectSame(await inBrowser(page, ''), node, browserName);
});

test('#150: a replayed Auental Match (the real bake, 8 Squads a side, vehicles) hashes the same in this browser as in Node', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const a = readBake('auental');
  const node = replayHashes(AUENTAL_RECORD, REPLAY_TICKS, { ...a.map, terrain: terrainOf(a.map, a.cover, DEFAULT_TUNE.cellM) });
  expectSame(await inBrowser(page, '?map=auental', 100_000), node, browserName);
});
