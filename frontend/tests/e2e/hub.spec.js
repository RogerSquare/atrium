import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// feat-project-hub-impl-001 — the Hub merges the Loops and Demos views into
// one top-bar entry with sub-tabs. Legacy stored view ids ('loops'/'demos')
// migrate to Hub + the matching sub-tab. Fully mocked API.

test.describe('Hub view', () => {
  test.beforeEach(async ({ page }) => {
    await mockCoreApi(page); // already answers /api/loops with [] and core endpoints
    await page.route('**/api/demos/grouped', (route) => route.fulfill({ json: [] }));
  });

  test('opens on the Loops sub-tab by default and switches to Demos', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'hub' } });
    await page.goto('/');

    await expect(page.getByTestId('hub-view')).toBeVisible();
    await expect(page.getByTestId('loops-view')).toBeVisible();

    await page.getByTestId('hub-tab-demos').click();
    await expect(page.getByTestId('demos-view')).toBeVisible();
    await expect(page.getByTestId('loops-view')).toHaveCount(0);

    // The choice persists across a reload.
    await page.reload();
    await expect(page.getByTestId('demos-view')).toBeVisible();
  });

  test('a stored legacy view id migrates to Hub + the right sub-tab', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'demos' } });
    await page.goto('/');

    await expect(page.getByTestId('hub-view')).toBeVisible();
    await expect(page.getByTestId('demos-view')).toBeVisible();
    const migrated = await page.evaluate(() => [localStorage.getItem('taskBoardView'), localStorage.getItem('taskBoardHubTab')]);
    expect(migrated).toEqual(['hub', 'demos']);
  });

  test('the top bar has a Hub entry and no Loops/Demos entries', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Hub', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Loops', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Demos', exact: true })).toHaveCount(0);
  });
});
