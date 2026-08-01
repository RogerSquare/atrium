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

// ui-collapse-draft-col-001 — the Draft column can be collapsed to a thin
// rail to reclaim horizontal space, and the choice persists (localStorage,
// so it survives reload AND a backend restart since it lives in the browser).
test.describe('Draft column collapse', () => {
  // Seed localStorage before any app code runs: bypass the login gate (the
  // shared helper builds a decodable token — lib/session.js drops tokenless
  // users), force the board view, and skip the one-time OLED theme migration.
  // This runs on every navigation (including reload), so it MUST be idempotent
  // — it must NOT touch taskBoardDraftCollapsed, or it would wipe the very
  // state under test on reload. The fresh per-test context guarantees we
  // start expanded.
  test('collapses to a rail, persists across reload, and re-expands', async ({ page }) => {
    await mockCoreApi(page);
    // At least one task must exist — a zero-task board renders the empty-state
    // CTA (ui-topbar-create-001) instead of columns, so there would be no
    // Draft column to collapse.
    await page.route('**/api/tasks', (route) => route.fulfill({
      json: [{
        id: 'feat-seed-001', title: 'Seed task', status: 'todo', priority: 'medium',
        project: 'Alpha', type: 'fullstack', tags: [], files_affected: [],
        depends_on: [], activity_log: [], content: '', assignee: null,
      }],
    }));
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    const collapseBtn = page.getByRole('button', { name: 'Collapse Draft column' });
    const expandRail = page.getByRole('button', { name: /Expand Draft column/ });

    // Expanded by default: the full-column collapse control is present.
    await expect(collapseBtn).toBeVisible({ timeout: 20_000 });
    await expect(expandRail).toHaveCount(0);

    // Collapse → the rail replaces the full column.
    await collapseBtn.click();
    await expect(expandRail).toBeVisible();
    await expect(collapseBtn).toHaveCount(0);

    // Persists across a reload (the localStorage requirement).
    await page.reload();
    await expect(expandRail).toBeVisible({ timeout: 20_000 });
    await expect(collapseBtn).toHaveCount(0);

    // Re-expanding restores the full column.
    await expandRail.click();
    await expect(collapseBtn).toBeVisible();
    await expect(expandRail).toHaveCount(0);
  });
});
