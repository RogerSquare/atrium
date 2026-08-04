import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// mobile-ui-rework-impl-001 — the mobile regression suite, run ONLY by the
// mobile-chromium project (390×844, touch). Locks in the fixes from the
// mobile rework: reachable detail tabs, contained board tabs, safe-area
// sizing, touch targets, and the view-picker sheet. Fully mocked API.

const TASKS = [{
  id: 'feat-mob-001', title: 'Mobile probe task', status: 'todo', priority: 'medium',
  project: 'Alpha', type: 'backend', tags: [], files_affected: [], depends_on: [],
  activity_log: [], content: '### Description\nx\n\n### Comments\n', assignee: null,
}];

test.describe('Mobile web UI', () => {
  test.beforeEach(async ({ page }) => {
    await mockCoreApi(page);
    await page.route('**/api/tasks', (r) => r.fulfill({ json: TASKS }));
    await page.route('**/api/tasks/*', (r) => r.fulfill({ json: TASKS[0] }));
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');
  });

  test('BLOCKER regression: every detail tab is on-screen and clickable, Shell included', async ({ page }) => {
    await page.getByText('Mobile probe task').first().click();
    const strip = page.getByRole('tablist', { name: 'Task detail sections' });
    await expect(strip).toBeVisible();

    // No horizontal overflow in the strip.
    const m = await strip.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(m.scroll).toBeLessThanOrEqual(m.client);

    // Each tab is fully inside the viewport and ≥44px touch size.
    for (const id of ['description', 'comments', 'activity', 'changes', 'tests', 'shell']) {
      const tab = page.getByTestId(`detail-tab-${id}`);
      const box = await tab.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      // Rounded: 3x device scale renders 44px as 43.99998.
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
      expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
    }

    // The Shell tab actually activates — this was impossible before the fix.
    await page.getByTestId('detail-tab-shell').click();
    await expect(page.getByTestId('detail-tab-shell')).toHaveAttribute('aria-selected', 'true');
    // Icon-only strip: only the active tab shows its label.
    await expect(page.getByTestId('detail-tab-shell')).toContainText('Shell');
    await expect(page.getByTestId('detail-tab-description')).not.toContainText('Description');
  });

  test('board column tabs all fit the viewport', async ({ page }) => {
    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible(); // count() doesn't auto-wait
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < count; i++) {
      const box = await tabs.nth(i).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(390);
    }
  });

  test('safe-area sizing: tab bar, layout carve-out, and detail overlay all track the insets', async ({ page }) => {
    // Emulated browsers report env(safe-area-inset-*) as 0 — override the
    // vars with iPhone-ish values and assert every consumer follows.
    await page.addStyleTag({ content: ':root { --safe-bottom: 34px; --safe-top: 47px; }' });

    const bar = await page.getByTestId('mobile-tab-bar').boundingBox();
    expect(Math.round(bar.height)).toBe(49 + 34); // content + home indicator

    // The layout carves out exactly the bar's height — no covered content.
    const shellBottom = await page.evaluate(() => {
      const el = document.querySelector('.app-shell');
      return el ? Math.round(el.getBoundingClientRect().bottom) : null;
    });
    expect(shellBottom).toBe(844 - 83);

    // The detail overlay pads the notch at the top and clears the bar below.
    await page.getByText('Mobile probe task').first().click();
    const pad = await page.getByTestId('detail-pane').evaluate((el) => {
      const s = getComputedStyle(el);
      return { top: s.paddingTop, bottom: s.paddingBottom };
    });
    expect(pad.top).toBe('47px');
    expect(pad.bottom).toBe('83px');
  });

  test('no horizontal document overflow on board or list', async ({ page }) => {
    for (const view of ['board', 'list']) {
      await page.addInitScript(seedSession, { storage: { taskBoardView: view } });
      await page.goto('/');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${view} view overflows horizontally`).toBeLessThanOrEqual(0);
    }
  });
});
