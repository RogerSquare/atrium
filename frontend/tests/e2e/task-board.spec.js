import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// Dogfood for feat-e2e-validation-001. Confirms the atrium frontend
// hydrates past its initial shell — a step deeper than smoke.spec.js.
// The validator-side dogfood (review-transition gate) is verified via
// API curl tests in the implement task's structured comment, not here.

test('atrium frontend hydrates past initial shell', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle', { timeout: 20_000 });
  // Atrium ships a #root mount. After hydration it should contain children.
  await expect(page.locator('#root')).not.toBeEmpty();
});

// ui-collapse-draft-col-001 + ui-board-collapse-001 — Draft AND Done can
// collapse to thin rails, and since ui-board-collapse-001 BOTH start
// collapsed by default (drafts are half-formed, done is history — the board
// opens on active work). An explicit expansion persists via localStorage,
// so it survives reload AND a backend restart.
test.describe('Board column rails', () => {
  // Seed localStorage before any app code runs: bypass the login gate (the
  // shared helper builds a decodable token — lib/session.js drops tokenless
  // users), force the board view, and skip the one-time OLED theme migration.
  // This runs on every navigation (including reload), so it MUST be idempotent
  // — it must NOT touch the collapse keys, or it would wipe the very state
  // under test on reload. The fresh per-test context guarantees the default.
  test.beforeEach(async ({ page }) => {
    await mockCoreApi(page);
    // At least one task must exist — a zero-task board renders the empty-state
    // CTA (ui-topbar-create-001) instead of columns, so there would be no
    // columns to collapse.
    await page.route('**/api/tasks', (route) => route.fulfill({
      json: [{
        id: 'feat-seed-001', title: 'Seed task', status: 'todo', priority: 'medium',
        project: 'Alpha', type: 'fullstack', tags: [], files_affected: [],
        depends_on: [], activity_log: [], content: '', assignee: null,
      }],
    }));
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
  });

  test('Draft and Done open as rails by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('board-rail-draft')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('board-rail-done')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse Draft column' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collapse Done column' })).toHaveCount(0);
  });

  test('expanding persists across reload, and re-collapses', async ({ page }) => {
    await page.goto('/');

    const draftRail = page.getByTestId('board-rail-draft');
    const collapseDraft = page.getByRole('button', { name: 'Collapse Draft column' });

    // Expand → the full column replaces the rail.
    await expect(draftRail).toBeVisible({ timeout: 20_000 });
    await draftRail.click();
    await expect(collapseDraft).toBeVisible();
    await expect(draftRail).toHaveCount(0);

    // The expansion persists across a reload (the localStorage requirement).
    await page.reload();
    await expect(collapseDraft).toBeVisible({ timeout: 20_000 });
    await expect(draftRail).toHaveCount(0);
    // Done was untouched, so it is still a rail.
    await expect(page.getByTestId('board-rail-done')).toBeVisible();

    // Re-collapsing restores the rail.
    await collapseDraft.click();
    await expect(draftRail).toBeVisible();
    await expect(collapseDraft).toHaveCount(0);
  });

  test('Done expands and collapses independently of Draft', async ({ page }) => {
    await page.goto('/');
    const doneRail = page.getByTestId('board-rail-done');
    await expect(doneRail).toBeVisible({ timeout: 20_000 });
    await doneRail.click();
    await expect(page.getByRole('button', { name: 'Collapse Done column' })).toBeVisible();
    // Draft stays a rail throughout.
    await expect(page.getByTestId('board-rail-draft')).toBeVisible();
  });
});
