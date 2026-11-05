import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts', // keeps these out of vitest's *.test.ts / *.spec.ts sweep
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: { command: `vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}/e2e/replay.html` },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ],
});
