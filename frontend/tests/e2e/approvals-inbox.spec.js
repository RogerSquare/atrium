import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-approvals-inbox-001 — waiting_input becomes visible + actionable in the
// default shell: TopBar bell with a live count and inbox popover, an
// actionable ApprovalPanel inside the DetailPane, and a card-level chip.
// Fully mocked API.

const WAITING_TASK = {
  id: 'feat-wait-001', title: 'Pick a deploy order', status: 'waiting_input',
  priority: 'high', project: 'Alpha', type: 'backend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '### Description\nx\n\n### Comments', assignee: 'agent:probe',
};
const NORMAL_TASK = {
  id: 'feat-calm-001', title: 'Calm task', status: 'todo',
  priority: 'medium', project: 'Alpha', type: 'frontend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '', assignee: null,
};
const APPROVAL = {
  id: 'appr-1', prompt: 'Run the migration before or after the deploy?',
  options: ['before', 'after', 'cancel'],
  created_by: 'agent:probe', created_at: '2026-08-01T00:00:00.000Z',
  context: { reasoning: 'Schema change is not backward compatible.' },
};

async function mockApprovalsWorld(page, { withWaiting = true, onRespond } = {}) {
  await mockCoreApi(page);
  await page.route('**/api/tasks', (route) => route.fulfill({
    json: withWaiting ? [WAITING_TASK, NORMAL_TASK] : [NORMAL_TASK],
  }));
  await page.route('**/api/approvals/task/feat-wait-001', (route) => route.fulfill({
    json: { approvals: [APPROVAL] },
  }));
  await page.route('**/api/approvals/task/feat-wait-001/appr-1/respond', (route) => {
    onRespond?.(route.request().postDataJSON());
    return route.fulfill({ json: { success: true } });
  });
}

test.describe('Approvals inbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
  });

  test('bell counts waiting tasks and its inbox opens the task in the DetailPane', async ({ page }) => {
    await mockApprovalsWorld(page);
    await page.goto('/');

    await expect(page.getByTestId('approvals-bell-count')).toHaveText('1', { timeout: 20_000 });
    await page.getByTestId('approvals-bell').click();
    const item = page.getByTestId('approvals-bell-item');
    await expect(item).toContainText('Pick a deploy order');
    await item.click();

    // DetailPane opens on the task with an ACTIONABLE approval card.
    await expect(page.getByTestId('detail-pane')).toBeVisible();
    await expect(page.getByText('1 approval needed')).toBeVisible();
    await expect(page.getByText(APPROVAL.prompt)).toBeVisible();
  });

  test('responding from the DetailPane posts the chosen option', async ({ page }) => {
    let posted = null;
    await mockApprovalsWorld(page, { onRespond: (b) => { posted = b; } });
    await page.goto('/');

    await page.getByTestId('approvals-bell').click();
    await page.getByTestId('approvals-bell-item').click();
    await expect(page.getByText(APPROVAL.prompt)).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'after', exact: true }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted.response).toBe('after');
  });

  test('board card carries a waiting-on-you chip', async ({ page }) => {
    await mockApprovalsWorld(page);
    await page.goto('/');
    const chip = page.getByTestId('card-waiting-indicator');
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toContainText('Needs you');
  });

  test('quiet state: no badge, empty inbox message', async ({ page }) => {
    await mockApprovalsWorld(page, { withWaiting: false });
    await page.goto('/');
    const bell = page.getByTestId('approvals-bell');
    await expect(bell).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('approvals-bell-count')).toHaveCount(0);
    await bell.click();
    await expect(page.getByText('No tasks are waiting on you.')).toBeVisible();
  });
});
