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
    // Desktop runs every spec EXCEPT the mobile suite; the mobile project runs
    // ONLY the mobile suite at a real iPhone-ish viewport. Keeps desktop
    // timings untouched while mobile regressions (unreachable tabs, safe-area
    // sizing, touch targets) stay locked in CI.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.js/ },
    {
      name: 'mobile-chromium',
      testMatch: /mobile\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
