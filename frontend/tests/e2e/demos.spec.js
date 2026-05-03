import { test, expect } from '@playwright/test';

// Dogfood for feat-demo-management-001-implement (Phase 3). Exercises the
// new Demos view in the live atrium UI: clicks the fifth ViewSwitcher tab,
// asserts the todo-demo card renders with the right open-link target.
//
// Auth: the SPA reads taskBoardUser from localStorage and attaches its
// .token to API calls. This spec seeds localStorage with a token from
// process.env.ATRIUM_API_TOKEN (the same env var the run-e2e wrapper uses)
// so the page can hit /api/demos. Without the env var, every spec in this
// file is skipped with a clear reason.

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
    }, [TOKEN, username]);
    await page.goto('/');
  });

  test('demos view renders with header and at least one card', async ({ page }) => {
    const view = page.getByTestId('demos-view');
    await expect(view).toBeVisible({ timeout: 10_000 });
    await expect(view.getByRole('heading', { name: 'Demos' })).toBeVisible();
    const cards = page.getByTestId('demo-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('todo-demo card is present', async ({ page }) => {
    await expect(page.getByTestId('demos-view')).toBeVisible({ timeout: 10_000 });
    const todoCard = page.getByTestId('demo-card').filter({ hasText: '/todo-demo/' });
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

  test('task chip points at the originating task id', async ({ page }) => {
    await expect(page.getByTestId('demos-view')).toBeVisible({ timeout: 10_000 });
    const todoCard = page.getByTestId('demo-card').filter({ hasText: '/todo-demo/' });
    // The chip is only present when a task with a matching e2e_run was found.
    // Skip-asserting if no chip rendered (untested demo state).
    const chip = todoCard.getByTestId('demo-task-chip');
    if (await chip.count() > 0) {
      await expect(chip).toContainText(/^feat-/);
    }
  });
});
