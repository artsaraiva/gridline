import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5199); // set PORT per worktree when two runs share a machine
// CI runners have no GPU: headless Firefox gets no WebGL, and software WebGL in Chromium and WebKit is too slow for the
// Console's frame-driven chrome. CI runs only the replay test; run the Console smoke test locally before merging.
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts', // keeps these out of vitest's *.test.ts / *.spec.ts sweep
  testIgnore: CI ? 'console.e2e.ts' : [],
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: { command: `vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}/e2e/replay.html` },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ],
});
