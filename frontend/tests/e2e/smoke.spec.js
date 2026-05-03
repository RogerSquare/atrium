import { test, expect } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Atrium|Vite|React/i);
  await expect(page.locator('body')).not.toBeEmpty();
});
