import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-shell-consolidation-001 — one shell. The legacy AppContent path and the
// atriumFacelift flag are deleted; chat is ported into the AppShell side dock.
// The preservation contract pins the historical facelift-regression cases:
// BulkActionBar, filters, undo/redo, and the shell rendering regardless of any
// stale flag value. Fully mocked API.

const TASKS = [
  {
    id: 'feat-alpha-001', title: 'Frontend alpha', status: 'todo', priority: 'high',
    project: 'Alpha', type: 'frontend', tags: [], files_affected: [], depends_on: [],
    activity_log: [], content: '### Description\nx\n\n### Comments', assignee: null,
  },
  {
    id: 'feat-beta-001', title: 'Backend beta', status: 'todo', priority: 'medium',
    project: 'Alpha', type: 'backend', tags: [], files_affected: [], depends_on: [],
    activity_log: [], content: '### Description\ny\n\n### Comments', assignee: null,
  },
];

async function mockWorld(page, { onTaskPut } = {}) {
  await mockCoreApi(page);
  await page.route('**/api/chat/messages', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/tasks', (route) => route.fulfill({ json: TASKS }));
  await page.route('**/api/tasks/feat-alpha-001', (route) => {
    if (route.request().method() === 'PUT') {
      onTaskPut?.(route.request().postDataJSON());
      return route.fulfill({ json: { success: true, task: { ...TASKS[0], ...route.request().postDataJSON() } } });
    }
    return route.fulfill({ json: TASKS[0] });
  });
}

test.describe('Shell consolidation', () => {
  test('a stale atriumFacelift=false value no longer resurrects the legacy shell', async ({ page }) => {
    await mockWorld(page);
    await page.addInitScript(seedSession, {
      storage: { taskBoardView: 'board', atriumFacelift: 'false' },
    });
    await page.goto('/');
    // AppShell fingerprints: the TopBar create button + the filter bar reset
    // affordance region. The legacy shell had neither testid.
    await expect(page.getByTestId('topbar-new-task')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('topbar-chat')).toBeVisible();
  });

  test('team chat opens as a dock occupant and closes back to the board', async ({ page }) => {
    await mockWorld(page);
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await page.getByTestId('topbar-chat').click();
    const panel = page.getByTestId('chat-panel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('No messages yet');

    // Close from the panel header — the dock hands back to the board.
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('chat and the task pane share the dock — picking a task hands it back', async ({ page }) => {
    await mockWorld(page);
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await page.getByTestId('topbar-chat').click();
    await expect(page.getByTestId('chat-panel')).toBeVisible({ timeout: 20_000 });

    await page.getByText('Frontend alpha').click();
    await expect(page.getByTestId('detail-pane')).toBeVisible();
    await expect(page.getByTestId('chat-panel')).toHaveCount(0);
  });

  test('preservation: bulk select still summons the BulkActionBar', async ({ page }) => {
    await mockWorld(page);
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await page.getByRole('button', { name: 'Enter multi-select mode' }).click();
    await page.getByRole('checkbox', { name: 'Select task Frontend alpha' }).check();
    await expect(page.getByText('1 selected')).toBeVisible();
  });

  test('preservation: the type filter narrows the board', async ({ page }) => {
    await mockWorld(page);
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await expect(page.getByText('Backend beta')).toBeVisible({ timeout: 20_000 });
    // The Type select is the first combobox in the filter bar (it has no
    // accessible name yet — ui-copy-glossary-001 territory).
    await page.locator('select.facelift-pill').first().selectOption('frontend');
    await expect(page.getByText('Backend beta')).toHaveCount(0);
    await expect(page.getByText('Frontend alpha')).toBeVisible();
  });

  test('preservation: a status change from the DetailPane is undoable', async ({ page }) => {
    let putBody = null;
    await mockWorld(page, { onTaskPut: (b) => { putBody = b; } });
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await page.getByText('Frontend alpha').click();
    await expect(page.getByTestId('detail-pane')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('radio', { name: 'In Progress' }).click();

    await expect.poll(() => putBody).not.toBeNull();
    expect(putBody.status).toBe('in_progress');
    await expect(page.getByRole('button', { name: /Undo/ })).toBeVisible();
  });
});
