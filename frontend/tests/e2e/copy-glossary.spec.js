import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-copy-glossary-001 — UBIQUITOUS_LANGUAGE copy pass: Root scope reads
// "No project" (not "Unassigned", which belongs to the assignee filter),
// waiting_input surfaces as "Needs your decision", the drop-disabled safety
// column explains itself, an expired session explains the logout, and the
// Help modal links the glossary. Fully mocked API.

const WAITING = {
  id: 'feat-waiting-001', title: 'Paused on a question', status: 'waiting_input',
  priority: 'medium', project: 'Root', type: 'backend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '### Description\nx\n\n### Comments', assignee: null,
};
const LOST = {
  id: 'bug-lost-001', title: 'Task with a broken status', status: 'archived',
  priority: 'low', project: 'Root', type: 'backend', tags: [],
  files_affected: [], depends_on: [], activity_log: [], content: '', assignee: null,
};

test.describe('Glossary copy pass', () => {
  test.beforeEach(async ({ page }) => {
    await mockCoreApi(page);
    await page.route('**/api/tasks', (route) => route.fulfill({ json: [WAITING, LOST] }));
    // One handler, split on the query — fulfilling ?include=archived with the
    // Root row makes useTasks think the active project was archived and it
    // silently resets the scope to 'All'.
    await page.route('**/api/projects**', (route) => {
      const archived = route.request().url().includes('include=archived');
      return route.fulfill({ json: archived ? [] : [{ folder: 'Root', name: 'Root', id: 'root' }] });
    });
  });

  test('Root scope reads "No project" in the anchor and its listbox', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { opusBoardActiveProject: 'Root', taskBoardView: 'board' } });
    await page.goto('/');

    const anchor = page.getByRole('button', { name: /No project/ });
    await expect(anchor).toBeVisible();

    await anchor.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toContainText('No project');
    await expect(listbox).not.toContainText('Unassigned');
  });

  test('waiting_input badge reads "Needs your decision" in the detail pane', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await page.getByText('Paused on a question').click();
    await expect(page.getByText('Needs your decision')).toBeVisible({ timeout: 20_000 });
  });

  test('safety column explains why tasks land there', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await expect(page.getByText('Uncategorized')).toBeVisible();
    await expect(page.getByTestId('safety-column-hint')).toContainText('waiting on your decision');
  });

  test('expired stored session explains the logout on the login screen', async ({ page }) => {
    // seedSession always mints a live token — hand-roll an EXPIRED one so
    // loadStoredSession returns { expired: true } and Login gets the prop.
    await page.addInitScript(() => {
      const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ username: 'e2e', exp: Math.floor(Date.now() / 1000) - 3600 })}.e2e`;
      localStorage.setItem('taskBoardUser', JSON.stringify({ username: 'e2e', token }));
      localStorage.setItem('taskBoardThemeMigratedToOled', '1');
    });
    await page.goto('/');

    await expect(page.getByTestId('session-expired-banner')).toContainText('Your session ended');
    // Still a functional login screen, not an error page.
    await expect(page.getByPlaceholder('Enter your username')).toBeVisible();
  });

  test('Help modal links the glossary', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await page.keyboard.press('?');
    const link = page.getByRole('link', { name: 'glossary' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /UBIQUITOUS_LANGUAGE\.md/);
  });
});
