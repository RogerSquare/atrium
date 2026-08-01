import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-topbar-create-001 — the P0 first-session unblocks: a visible New Task
// button in the TopBar, an empty-board CTA that explains the lifecycle,
// "All projects" reachable again from the project anchor, and a visible Help
// affordance. Fully mocked API (hermetic on any dev box).

const PROJECTS = [
  { id: 'p1', name: 'Alpha', folder: 'Alpha' },
  { id: 'p2', name: 'Beta', folder: 'Beta' },
];

test.describe('TopBar create + empty state + project anchor + help', () => {
  test.beforeEach(async ({ page }) => {
    await mockCoreApi(page);
    // Registered AFTER mockCoreApi so it wins (reverse registration order).
    await page.route('**/api/projects**', (route) => route.fulfill({ json: PROJECTS }));
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');
  });

  test('New Task button in the TopBar opens the create modal', async ({ page }) => {
    const btn = page.getByTestId('topbar-new-task');
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.click();
    await expect(page.locator('#create-task-title')).toHaveText('New Task');
  });

  test('empty board explains the lifecycle and its CTA opens the create modal', async ({ page }) => {
    const empty = page.getByTestId('board-empty-state');
    await expect(empty).toBeVisible({ timeout: 20_000 });
    await expect(empty).toContainText('review');
    await page.getByTestId('board-empty-create').click();
    await expect(page.locator('#create-task-title')).toHaveText('New Task');
  });

  test('project anchor: All projects is the default label and stays reachable after scoping', async ({ page }) => {
    const anchor = page.getByRole('button', { name: /All projects/ });
    await expect(anchor).toBeVisible({ timeout: 20_000 });

    // Scope to a project…
    await anchor.click();
    await page.getByRole('option', { name: /Alpha/ }).click();
    await expect(page.getByRole('button', { name: /Alpha/ }).first()).toBeVisible();

    // …and the pinned "All projects" row leads back out of it.
    await page.getByRole('button', { name: /Alpha/ }).first().click();
    const allRow = page.getByTestId('project-anchor-all');
    await expect(allRow).toBeVisible();
    await allRow.click();
    await expect(page.getByRole('button', { name: /All projects/ })).toBeVisible();
  });

  test('visible Help button opens the help modal', async ({ page }) => {
    const help = page.getByTestId('topbar-help');
    await expect(help).toBeVisible({ timeout: 20_000 });
    await help.click();
    await expect(page.locator('#help-modal-title')).toBeVisible();
  });
});
