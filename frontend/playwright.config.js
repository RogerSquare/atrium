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
    // Video is also always-on — gives reviewers a visceral "what the test
    // did" recording for every spec, not only failures. Larger than traces
    // (~1-5 MB per spec) but still bounded by MAX_E2E_RUNS_PER_TASK = 5.
    video: 'on',
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
