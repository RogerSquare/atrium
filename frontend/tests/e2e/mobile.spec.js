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

  test('board column carousel: full labels, scrollable strip, active pill readable', async ({ page }) => {
    const active = page.getByTestId('board-col-tab-todo');
    await expect(active).toBeVisible();
    await expect(active).toHaveText(/To Do/); // full label, not truncated
    const box = await active.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(390);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);

    // The strip scrolls (that's the design) instead of cramming/truncating.
    const strip = page.getByRole('tablist', { name: 'Board columns' });
    const overflow = await strip.evaluate((el) => ({ x: getComputedStyle(el).overflowX, scrollable: el.scrollWidth >= el.clientWidth }));
    expect(overflow.x).toBe('auto');

    // Selecting the LAST column centers it into view with its full label.
    await page.getByTestId('board-col-tab-done').click({ force: true });
    await expect(page.getByTestId('board-col-tab-done')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => {
      const b = await page.getByTestId('board-col-tab-done').boundingBox();
      return b && b.x >= 0 && b.x + b.width <= 390;
    }).toBe(true);
  });

  test('mobile filter bar: slim row with search + filters sheet', async ({ page }) => {
    await expect(page.getByTestId('filter-search')).toBeVisible();
    const toggle = page.getByTestId('filter-sheet-toggle');
    const tb = await toggle.boundingBox();
    expect(Math.round(tb.width)).toBeGreaterThanOrEqual(44);

    await toggle.click();
    const sheet = page.getByTestId('filter-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Stale')).toBeVisible();
    await expect(sheet.getByText('Active shells')).toBeVisible();

    // Toggling a filter works from the sheet; backdrop closes it.
    await sheet.getByText('Today').click();
    await expect(sheet.getByText('Today')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(195, 100); // backdrop
    await expect(sheet).toHaveCount(0);
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
