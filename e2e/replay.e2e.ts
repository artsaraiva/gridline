// Determinism across engines: the same Match record replayed in each browser must hash the same, tick for tick, as in Node.
import { expect, test } from '@playwright/test';
import { REPLAY_RECORD, REPLAY_TICKS, replayHashes } from '../src/host/replay';

test('a replayed Match hashes the same in this browser as in Node', async ({ page, browserName }) => {
  const node = replayHashes(REPLAY_RECORD, REPLAY_TICKS);
  await page.goto('/e2e/replay.html');
  const browser = await page.waitForFunction(() => (window as unknown as { hashes?: string[] }).hashes).then((h) => h.jsonValue() as Promise<string[]>);

  expect(REPLAY_RECORD.log.length).toBeGreaterThan(0);
  expect(browser).toHaveLength(REPLAY_TICKS);
  const tick = browser.findIndex((h, i) => h !== node[i]);
  expect(tick, `${browserName} diverges from Node at tick ${tick}: ${browser[tick]} vs ${node[tick]}`).toBe(-1);
});
