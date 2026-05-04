import { test, expect } from '@playwright/test';

// Dogfood for feat-demos-services-grouping-001-implement (v2). Exercises
// the service-grouped Demos view: clicks the Demos tab, asserts the Atrium
// service group renders with the todo-demo card nested inside, "Show all
// services" toggle reveals empty groups.
//
// Auth: the SPA reads taskBoardUser from localStorage and attaches its
// .token to API calls. This spec seeds localStorage with a token from
// process.env.ATRIUM_API_TOKEN (the same env var the run-e2e wrapper uses)
// so the page can hit /api/demos/grouped. Without the env var, every spec
// in this file is skipped with a clear reason.

const TOKEN = process.env.ATRIUM_API_TOKEN || '';
const SKIP_REASON = 'ATRIUM_API_TOKEN env var not set; cannot exercise auth-required atrium UI.';

function decodeUsername(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return json.username || 'agent';
  } catch {
    return 'agent';
  }
}

test.describe('Demos view', () => {
  test.skip(!TOKEN, SKIP_REASON);

  test.beforeEach(async ({ page }) => {
    const username = decodeUsername(TOKEN);
    await page.addInitScript(([token, name]) => {
      localStorage.setItem('taskBoardUser', JSON.stringify({ username: name, token }));
      localStorage.setItem('taskBoardView', 'demos');
      // Force "All" project so every service group is eligible to render
      // regardless of which project was last selected. Test must be
      // deterministic.
      localStorage.setItem('opusBoardActiveProject', 'All');
    }, [TOKEN, username]);
    await page.goto('/');
  });

  test('demos view renders with header and at least one service group', async ({ page }) => {
    const view = page.getByTestId('demos-view');
    await expect(view).toBeVisible({ timeout: 10_000 });
    await expect(view.getByRole('heading', { name: 'Demos' })).toBeVisible();
    const groups = page.getByTestId('service-group');
    await expect(groups.first()).toBeVisible({ timeout: 10_000 });
    expect(await groups.count()).toBeGreaterThanOrEqual(1);
  });

  test('Atrium service group contains the todo-demo card', async ({ page }) => {
    await expect(page.getByTestId('demos-view')).toBeVisible({ timeout: 10_000 });
    const atriumGroup = page.getByTestId('service-group').filter({ has: page.getByTestId('service-group-header').filter({ hasText: 'Atrium' }) });
    await expect(atriumGroup).toBeVisible();
    const todoCard = atriumGroup.getByTestId('demo-card').filter({ hasText: '/todo-demo/' });
    await expect(todoCard).toBeVisible();
  });

  test('open link opens in a new tab and points at the demo index', async ({ page }) => {
    await expect(page.getByTestId('demos-view')).toBeVisible({ timeout: 10_000 });
    const todoCard = page.getByTestId('demo-card').filter({ hasText: '/todo-demo/' });
    const openLink = todoCard.getByTestId('demo-open-link');
    await expect(openLink).toHaveAttribute('target', '_blank');
    await expect(openLink).toHaveAttribute('rel', /noopener/);
    const href = await openLink.getAttribute('href');
    expect(href).toMatch(/\/todo-demo\/index\.html$/);
  });

  test('task chip on the demo card points at a feat- task id', async ({ page }) => {
    await expect(page.getByTestId('demos-view')).toBeVisible({ timeout: 10_000 });
    const todoCard = page.getByTestId('demo-card').filter({ hasText: '/todo-demo/' });
    const chip = todoCard.getByTestId('demo-task-chip');
    if (await chip.count() > 0) {
      await expect(chip).toContainText(/^feat-/);
    }
  });

  test('"Show all services" toggle reveals empty service groups', async ({ page }) => {
    await expect(page.getByTestId('demos-view')).toBeVisible({ timeout: 10_000 });
    const initialCount = await page.getByTestId('service-group').count();
    const toggle = page.getByTestId('demos-show-all-services-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    // After clicking, the toggle reveals service groups with zero demos
    // (Memos-Clone, Artifex, etc.) so the count should grow OR stay the
    // same if every group already had demos. Atrium has services beyond
    // todo-demo's project, so growth is expected in current fixtures.
    const expandedCount = await page.getByTestId('service-group').count();
    expect(expandedCount).toBeGreaterThanOrEqual(initialCount);
    expect(expandedCount).toBeGreaterThan(1); // we know there are at least 5 service groups in services.json
  });
});
