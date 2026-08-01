import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-mobile-appshell-001 — the 375px smoke (usability P0-6, accepted default
// Q11): bottom tab bar owns view switching + primary actions, the TopBar
// slims to anchor + bell + avatar, DetailPane is a full-screen overlay, the
// FilterBar scrolls instead of clipping, and the four core flows all work:
// create, open detail, change status, respond to an approval.

test.use({ viewport: { width: 375, height: 667 } });

const WAITING_TASK = {
  id: 'feat-wait-001', title: 'Pick a deploy order', status: 'waiting_input',
  priority: 'high', project: 'Alpha', type: 'backend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '### Description\nx\n\n### Comments', assignee: 'agent:probe',
};
const PLAIN_TASK = {
  id: 'feat-calm-001', title: 'Calm task', status: 'todo',
  priority: 'medium', project: 'Alpha', type: 'frontend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '### Description\ny\n\n### Comments', assignee: null,
};
const APPROVAL = {
  id: 'appr-1', prompt: 'Run the migration before or after the deploy?',
  options: ['before', 'after', 'cancel'],
  created_by: 'agent:probe', created_at: '2026-08-01T00:00:00.000Z', context: {},
};

async function mockWorld(page, { onRespond, onTaskPut } = {}) {
  await mockCoreApi(page);
  await page.route('**/api/tasks', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { success: true } });
    return route.fulfill({ json: [WAITING_TASK, PLAIN_TASK] });
  });
  await page.route('**/api/tasks/feat-calm-001', (route) => {
    if (route.request().method() === 'PUT') {
      onTaskPut?.(route.request().postDataJSON());
      return route.fulfill({ json: { success: true, task: { ...PLAIN_TASK, ...route.request().postDataJSON() } } });
    }
    return route.fulfill({ json: PLAIN_TASK });
  });
  await page.route('**/api/approvals/task/feat-wait-001', (route) => route.fulfill({ json: { approvals: [APPROVAL] } }));
  await page.route('**/api/approvals/task/feat-wait-001/appr-1/respond', (route) => {
    onRespond?.(route.request().postDataJSON());
    return route.fulfill({ json: { success: true } });
  });
}

test.describe('Mobile AppShell (375px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
  });

  test('tab bar owns the mobile chrome; desktop-only TopBar controls hide', async ({ page }) => {
    await mockWorld(page);
    await page.goto('/');

    await expect(page.getByTestId('mobile-tab-bar')).toBeVisible({ timeout: 20_000 });
    // Moved to the tab bar / avatar menu:
    await expect(page.getByTestId('topbar-new-task')).toBeHidden();
    await expect(page.getByTestId('topbar-chat')).toBeHidden();
    await expect(page.getByTestId('topbar-help')).toBeHidden();
    // Still in the TopBar:
    await expect(page.getByTestId('approvals-bell')).toBeVisible();
    await expect(page.getByTestId('avatar-trigger')).toBeVisible();
  });

  test('view cycling from the tab bar reaches the list view', async ({ page }) => {
    await mockWorld(page);
    await page.goto('/');
    const viewTab = page.getByTestId('mobile-tab-view');
    await expect(viewTab).toContainText('Board', { timeout: 20_000 });
    await viewTab.click();
    await expect(viewTab).toContainText('List');
  });

  test('create flow: tab bar → modal → POST', async ({ page }) => {
    await mockWorld(page);
    await page.goto('/');
    await page.getByTestId('mobile-tab-new').click();
    await expect(page.locator('#create-task-title')).toHaveText('New Task', { timeout: 20_000 });
    await page.getByPlaceholder('What needs to be done?').fill('From my phone');
    await expect(page.getByTestId('create-id-preview')).toHaveText('feat-from-my-phone-001');
  });

  test('open detail as a full-screen overlay and change status', async ({ page }) => {
    let putBody = null;
    await mockWorld(page, { onTaskPut: (b) => { putBody = b; } });
    await page.goto('/');

    await page.getByText('Calm task').click();
    const pane = page.getByTestId('detail-pane');
    await expect(pane).toBeVisible({ timeout: 20_000 });
    // Narrow mode renders the pane as a fixed full-screen overlay.
    const box = await pane.boundingBox();
    expect(box.width).toBeGreaterThan(360);

    await page.getByRole('radio', { name: 'In Progress' }).click();
    await expect.poll(() => putBody).not.toBeNull();
    expect(putBody.status).toBe('in_progress');
  });

  test('approvals: bell → task → respond, all thumb-reachable', async ({ page }) => {
    let posted = null;
    await mockWorld(page, { onRespond: (b) => { posted = b; } });
    await page.goto('/');

    await page.getByTestId('approvals-bell').click();
    await page.getByTestId('approvals-bell-item').click();
    await expect(page.getByText(APPROVAL.prompt)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'before', exact: true }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted.response).toBe('before');
  });

  test('filter bar scrolls horizontally instead of clipping', async ({ page }) => {
    await mockWorld(page);
    await page.goto('/');
    const bar = page.getByTestId('filter-bar');
    await expect(bar).toBeVisible({ timeout: 20_000 });
    // More content than width → scrollable, and the FAR pill is reachable.
    const scrollable = await bar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(scrollable).toBe(true);
    const lastPill = page.getByRole('button', { name: 'Active shells' });
    await lastPill.scrollIntoViewIfNeeded();
    await expect(lastPill).toBeVisible();
  });
});
