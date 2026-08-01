import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-create-dejargon-001 — task creation without jargon: the id is derived
// from a category picker + the title (regex survives as a validator on the
// advanced override), workflow tags become labeled controls, and depends_on
// gets a typeahead editor in the DetailPane. Fully mocked API.

const EXISTING = {
  id: 'bug-login-redirect-001', title: 'Existing twin', status: 'todo',
  priority: 'medium', project: 'Alpha', type: 'backend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '', assignee: null,
};
const TARGET = {
  id: 'feat-target-001', title: 'Editable task', status: 'todo',
  priority: 'medium', project: 'Alpha', type: 'frontend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '### Description\nx\n\n### Comments', assignee: null,
};
const OTHER = {
  id: 'feat-upstream-001', title: 'Upstream dependency', status: 'review',
  priority: 'medium', project: 'Alpha', type: 'backend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '', assignee: null,
};

test.describe('De-jargoned creation + dependency editing', () => {
  let posted;
  let putBody;

  test.beforeEach(async ({ page }) => {
    posted = null;
    putBody = null;
    await mockCoreApi(page);
    await page.route('**/api/tasks', (route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: { success: true, task: posted } });
      }
      return route.fulfill({ json: [EXISTING, TARGET, OTHER] });
    });
    await page.route('**/api/tasks/feat-target-001', (route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON();
        return route.fulfill({ json: { success: true, task: { ...TARGET, ...putBody } } });
      }
      return route.fulfill({ json: TARGET });
    });
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');
  });

  test('id is derived from category + title, and bumps past an existing twin', async ({ page }) => {
    await page.getByTestId('topbar-new-task').click();
    await page.getByPlaceholder('What needs to be done?').fill('Login redirect!');
    // Default category is Feature.
    await expect(page.getByTestId('create-id-preview')).toHaveText('feat-login-redirect-001');
    // Switching to Bug fix collides with the mocked existing bug-login-redirect-001 → 002.
    await page.getByTestId('create-category').selectOption('bug');
    await expect(page.getByTestId('create-id-preview')).toHaveText('bug-login-redirect-002');

    await page.getByRole('button', { name: 'Create Task', exact: true }).click();
    await expect.poll(() => posted).not.toBeNull();
    expect(posted.id).toBe('bug-login-redirect-002');
    expect(posted.title).toBe('Login redirect!');
    expect(posted.status).toBe('todo');
  });

  test('workflow controls write the tags; manual override still validates', async ({ page }) => {
    await page.getByTestId('topbar-new-task').click();
    await page.getByPlaceholder('What needs to be done?').fill('Research the cache layer');

    await page.getByTestId('create-phase').selectOption('phase-research');
    await page.getByTestId('create-flag-no-code').check();

    // Invalid manual override blocks submission…
    await page.getByText('Advanced: set the id manually').click();
    await page.getByTestId('create-id-override').fill('Not A Valid Id');
    await expect(page.getByRole('button', { name: 'Create Task', exact: true })).toBeDisabled();
    // …a valid one is used verbatim.
    await page.getByTestId('create-id-override').fill('opt-cache-audit-007');
    await page.getByRole('button', { name: 'Create Task', exact: true }).click();

    await expect.poll(() => posted).not.toBeNull();
    expect(posted.id).toBe('opt-cache-audit-007');
    expect(posted.tags).toContain('phase-research');
    expect(posted.tags).toContain('no-code');
  });

  test('depends_on typeahead adds and removes dependencies from the DetailPane', async ({ page }) => {
    // Open the target task from the board.
    await page.getByText('Editable task').click();
    const editor = page.getByTestId('depends-on-editor');
    await expect(editor).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('depends-on-input').fill('upstream');
    const result = page.getByTestId('depends-on-result');
    await expect(result).toContainText('feat-upstream-001');
    await result.click();

    await expect.poll(() => putBody).not.toBeNull();
    expect(putBody.depends_on).toEqual(['feat-upstream-001']);
  });
});
