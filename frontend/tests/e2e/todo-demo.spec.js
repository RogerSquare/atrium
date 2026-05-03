import { test, expect } from '@playwright/test';

// Dogfood for feat-e2e-demo-app-001. Exercises the static todo demo at
// /todo-demo/ to populate the Tests tab (PR #107) with non-trivial coverage
// and verify the e2e validation gate (PR #105) flips e2e_status to passing.

// Vite's SPA fallback (default appType: 'spa') intercepts the bare /todo-demo/
// directory URL and returns the React shell. Requesting the explicit
// index.html bypasses the fallback and serves the static file from public/.
test.beforeEach(async ({ page }) => {
  await page.goto('/todo-demo/index.html');
});

test('add an item appends to the list and clears the input', async ({ page }) => {
  const input = page.getByTestId('todo-input');
  await input.fill('write the spec');
  await page.getByTestId('todo-add').click();

  const items = page.getByTestId('todo-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('write the spec');
  await expect(input).toHaveValue('');
});

test('toggling an item marks it completed', async ({ page }) => {
  await page.getByTestId('todo-input').fill('toggle me');
  await page.getByTestId('todo-add').click();

  const item = page.getByTestId('todo-item').first();
  await expect(item).toHaveAttribute('data-completed', 'false');

  await item.getByTestId('todo-toggle').check();
  await expect(item).toHaveAttribute('data-completed', 'true');
});

test('deleting an item removes it from the list', async ({ page }) => {
  await page.getByTestId('todo-input').fill('delete me');
  await page.getByTestId('todo-add').click();

  const items = page.getByTestId('todo-item');
  await expect(items).toHaveCount(1);

  await items.first().getByTestId('todo-delete').click();
  await expect(items).toHaveCount(0);
});

test('filter buttons hide the non-matching items', async ({ page }) => {
  const input = page.getByTestId('todo-input');
  const add = page.getByTestId('todo-add');

  for (const text of ['one', 'two', 'three']) {
    await input.fill(text);
    await add.click();
  }

  const items = page.getByTestId('todo-item');
  await items.nth(1).getByTestId('todo-toggle').check();

  await page.getByTestId('filter-active').click();
  await expect(page.locator('[data-testid="todo-item"]:visible')).toHaveCount(2);

  await page.getByTestId('filter-completed').click();
  await expect(page.locator('[data-testid="todo-item"]:visible')).toHaveCount(1);

  await page.getByTestId('filter-all').click();
  await expect(page.locator('[data-testid="todo-item"]:visible')).toHaveCount(3);
});

test('items survive a page reload via localStorage', async ({ page }) => {
  const input = page.getByTestId('todo-input');
  const add = page.getByTestId('todo-add');

  await input.fill('persist one');
  await add.click();
  await input.fill('persist two');
  await add.click();

  await page.reload();

  const items = page.getByTestId('todo-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('persist one');
  await expect(items.nth(1)).toContainText('persist two');
});

test('item count footer reflects active count', async ({ page }) => {
  const count = page.getByTestId('todo-count');
  const input = page.getByTestId('todo-input');
  const add = page.getByTestId('todo-add');

  await expect(count).toHaveText('0 items left');

  await input.fill('a');
  await add.click();
  await expect(count).toHaveText('1 item left');

  await input.fill('b');
  await add.click();
  await input.fill('c');
  await add.click();
  await expect(count).toHaveText('3 items left');

  await page.getByTestId('todo-item').first().getByTestId('todo-toggle').check();
  await expect(count).toHaveText('2 items left');
});
