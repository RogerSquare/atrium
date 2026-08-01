import { test, expect } from '@playwright/test';
import { seedSession } from './helpers/session.js';

// ui-services-v2-001 — the Settings services tab surfaces the v2 service
// model (feat-service-surfaces-001): surface picker + conditional port
// requirement in the Add form, env/autostart fields, surface badges,
// PID/uptime on rows, and collapsible groups.
//
// The whole API is mocked with page.route so the spec exercises the UI
// contract (what the form SENDS, what the list RENDERS) without needing a
// live backend. The stored session must be a parseable, unexpired JWT —
// lib/session.js drops tokenless users on boot.

const NINETY_MIN_AGO = new Date(Date.now() - 90 * 60 * 1000).toISOString();

const FIXTURE_SERVICES = [
  {
    id: 'web-1', name: 'Web App', group: 'Alpha', type: 'process', surface: 'web',
    port: 5199, cwd: '/x', startCmd: 'npm run dev', depends_on: [],
    status: 'running', pid: 4242, startedAt: NINETY_MIN_AGO, hasLogs: false,
  },
  {
    id: 'cli-1', name: 'Kaleido', group: 'Alpha', type: 'process', surface: 'cli',
    cwd: '/x', startCmd: 'kaleido', depends_on: [],
    status: 'stopped', pid: null, startedAt: null, hasLogs: false,
  },
  {
    id: 'job-1', name: 'Swift Tests', group: 'Beta', type: 'process', surface: 'job',
    cwd: '/y', startCmd: 'swift test', depends_on: [],
    status: 'succeeded', pid: null, startedAt: null, hasLogs: true,
  },
];

async function mockApi(page, { onServicePost }) {
  // Catch-all FIRST — Playwright matches routes in reverse registration
  // order, so the specific mocks below win.
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/tasks**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/projects**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/users', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/agent-tokens', (route) => route.fulfill({ json: { tokens: [] } }));
  await page.route('**/api/github/**', (route) => route.fulfill({ json: { connected: false } }));
  // Without complete:true the first-run wizard overlays the whole app.
  await page.route('**/api/setup/status', (route) => route.fulfill({ json: { complete: true } }));
  await page.route('**/api/settings', (route) => route.fulfill({
    json: { workingDirectory: 'C:/work', agents_enabled: true, ai_chat_enabled: true },
  }));
  await page.route('**/api/settings/status', (route) => route.fulfill({
    json: {
      version: 'e2e', node_version: 'v22', uptime: '1m',
      counts: { tasks: 0, projects: 0, users: 1, history_backups: 0 },
      storage: { tasks: 0, history: 0, chat: 0, users: 0 },
    },
  }));
  await page.route('**/api/services', (route) => {
    if (route.request().method() === 'POST') {
      onServicePost?.(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { id: 'new' } });
    }
    return route.fulfill({ json: FIXTURE_SERVICES });
  });
}

async function openServicesTab(page) {
  await page.goto('/');
  // Avatar popover (top bar) → Settings → Services tab.
  const avatar = page.locator('button[aria-haspopup="menu"]').first();
  await expect(avatar).toBeVisible({ timeout: 20_000 });
  await avatar.click();
  await page.getByText('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await expect(page.getByText('Service Registry')).toBeVisible();
}

test.describe('Services UI v2', () => {
  test.beforeEach(async ({ page }) => {
    // Admin role: the Services tab only renders for admins.
    await page.addInitScript(seedSession, { role: 'admin' });
  });

  test('rows show surface badge, PID + uptime, and no port for portless services', async ({ page }) => {
    await mockApi(page, {});
    await openServicesTab(page);

    // One badge per service, showing its surface.
    await expect(page.getByTestId('service-surface-badge')).toHaveText(['web', 'cli', 'job']);

    // Port only where one exists — never ":undefined" for cli/job surfaces.
    await expect(page.getByText(':5199')).toBeVisible();
    await expect(page.getByText(':undefined')).toHaveCount(0);
    await expect(page.getByText(':null')).toHaveCount(0);

    // PID + uptime on the running service (absorbs ui-services-006).
    await expect(page.getByText('PID 4242')).toBeVisible();
    await expect(page.getByTestId('service-uptime')).toHaveText('up 1h 30m');

    // Job status renders its run-derived state, not stopped/red.
    await expect(page.getByText('succeeded')).toBeVisible();

    // A not-running job offers "Run", not "Start".
    const jobRow = page.locator('div.rounded-xl', { hasText: 'Swift Tests' }).last();
    await expect(jobRow.locator('button[title="Run"]')).toBeVisible();
  });

  test('groups collapse and expand (absorbs ui-services-009)', async ({ page }) => {
    await mockApi(page, {});
    await openServicesTab(page);

    const alphaHeader = page.getByRole('button', { name: /Alpha/ });
    await expect(page.getByText('Web App')).toBeVisible();
    await alphaHeader.click();
    await expect(page.getByText('Web App')).toHaveCount(0);
    // The other group is untouched.
    await expect(page.getByText('Swift Tests')).toBeVisible();
    await alphaHeader.click();
    await expect(page.getByText('Web App')).toBeVisible();
  });

  test('add form: port required only for web/server; job posts surface+env+autostart without a port', async ({ page }) => {
    let posted = null;
    await mockApi(page, { onServicePost: (body) => { posted = body; } });
    await openServicesTab(page);

    await page.locator('button[title="Add"]').click();

    // Default surface is web → port is required.
    const portInput = page.getByPlaceholder(/^Port/);
    await expect(portInput).toHaveJSProperty('required', true);

    // job → port optional.
    await page.getByRole('radio', { name: 'job' }).click();
    await expect(portInput).toHaveAttribute('placeholder', 'Port (optional)');
    await expect(portInput).toHaveJSProperty('required', false);

    await page.getByPlaceholder('Service Name').fill('CI Build');
    await page.getByPlaceholder('Group').fill('Beta');
    await page.getByPlaceholder('Start Cmd').fill('make test');
    await page.getByPlaceholder('Working Dir').fill('/tmp/ci');
    await page.getByPlaceholder(/KEY=value/).fill('FOO=bar\nBAZ=qux');
    await page.getByText('Start automatically when Atrium boots').click();
    await page.getByRole('button', { name: 'Register' }).click();

    await expect.poll(() => posted).not.toBeNull();
    expect(posted.surface).toBe('job');
    expect(posted.autostart).toBe(true);
    expect(posted.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
    expect(posted.name).toBe('CI Build');
    expect(posted.port).toBe('');

    // Successful register closes the form.
    await expect(page.getByRole('button', { name: 'Register' })).toHaveCount(0);
  });
});
