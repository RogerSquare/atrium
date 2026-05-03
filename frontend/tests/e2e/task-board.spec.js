import { test, expect } from '@playwright/test';

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
