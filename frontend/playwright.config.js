import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Trace is always-on so reviewers can step through every spec in the
    // Playwright trace viewer (DOM snapshot + actions + network), not just
    // failures. Storage cost is small (~500 KB-1 MB per spec, capped at 5
    // runs per task by the e2eRuns route's pruneOldRuns).
    trace: 'on',
    // Video stays failure-only — videos are large and most useful as
    // forensics, not as routine evidence.
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
