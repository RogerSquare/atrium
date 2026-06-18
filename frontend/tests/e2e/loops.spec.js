import { test, expect } from '@playwright/test';

// Loops view e2e (feat-loops-ui-global-001). The full create -> list -> toggle
// -> run flow needs a backend that serves /api/loops (model+engine phases) plus
// a valid token, so it's gated on ATRIUM_API_TOKEN exactly like demos.spec.js.
// Without the token the whole describe skips (suite stays green); with it, run:
//   ATRIUM_API_TOKEN="eyJ..." npm run test:e2e -- loops.spec.js
const TOKEN = process.env.ATRIUM_API_TOKEN || '';

function decodeUsername(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return json.username || 'agent';
  } catch {
    return 'agent';
  }
}

// Rendering + modal are client-side, so this runs without a backend: seed a
// username (enough to clear the login gate, per task-board.spec.js) and assert
// the view + create modal render.
test.describe('Loops view (render)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('taskBoardUser', JSON.stringify({ username: 'e2e' }));
      localStorage.setItem('taskBoardView', 'loops');
      localStorage.setItem('taskBoardThemeMigratedToOled', '1');
    });
    await page.goto('/');
  });

  test('renders the loops view and opens the create modal', async ({ page }) => {
    await expect(page.getByTestId('loops-view')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('new-loop-button').click();
    await expect(page.getByTestId('loop-modal')).toBeVisible();
  });
});

// The full create -> list -> toggle -> run flow needs a backend serving
// /api/loops (model+engine phases) + a token, so it's gated on ATRIUM_API_TOKEN.
test.describe('Loops view (backend flow)', () => {
  test.skip(!TOKEN, 'ATRIUM_API_TOKEN env var not set');

  test.beforeEach(async ({ page }) => {
    const username = decodeUsername(TOKEN);
    await page.addInitScript(([token, name]) => {
      localStorage.setItem('taskBoardUser', JSON.stringify({ username: name, token }));
      localStorage.setItem('taskBoardView', 'loops');
      localStorage.setItem('taskBoardThemeMigratedToOled', '1');
    }, [TOKEN, username]);
    await page.goto('/');
  });

  test('create -> appears in list -> toggle -> run', async ({ page }) => {
    const name = `e2e watcher ${Date.now()}`;
    await expect(page.getByTestId('loops-view')).toBeVisible({ timeout: 15_000 });

    // Create
    await page.getByTestId('new-loop-button').click();
    const modal = page.getByTestId('loop-modal');
    await expect(modal).toBeVisible();
    await modal.getByLabel('Name').fill(name);
    await modal.getByRole('button', { name: 'Create' }).click();

    // Appears in the list
    const row = page.getByTestId('loop-row').filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Toggle enable off
    await row.getByLabel(/Toggle/).click();

    // Run now (button is present + clickable)
    await row.getByRole('button', { name: 'Run now' }).click();

    // Clean up
    page.on('dialog', (d) => d.accept());
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0, { timeout: 10_000 });
  });
});
