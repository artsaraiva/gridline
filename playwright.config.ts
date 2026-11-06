import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;
// CI runners have no GPU: the Console renders through slow software WebGL there, and headless Firefox gets no WebGL at all.
// So CI runs the Console smoke test on Chromium only, one test at a time; run the full matrix locally.
const CI = !!process.env.CI;
const gpuOnly = CI ? 'console.e2e.ts' : [];

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts', // keeps these out of vitest's *.test.ts / *.spec.ts sweep
  workers: CI ? 1 : undefined,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: { command: `vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}/e2e/replay.html` },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'], testIgnore: gpuOnly },
    { name: 'webkit', use: devices['Desktop Safari'], testIgnore: gpuOnly },
  ],
});
