import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-list-redesign-impl-001 — the reworked List view: status-grouped default
// with Done collapsed, Thread grouping (families ∪ depends_on chains), the
// id chip inside the title cell, inline status editing through the shared
// Select, keyboard navigation, mobile cards, and the zero-state CTA.
// Fully mocked API.

const BASE = { priority: 'medium', project: 'Alpha', type: 'backend', tags: [], files_affected: [], depends_on: [], activity_log: [], content: '', assignee: null };
const TASKS = [
  { ...BASE, id: 'feat-alpha-001', title: 'Alpha in flight', status: 'in_progress' },
  { ...BASE, id: 'feat-beta-001', title: 'Beta waiting', status: 'todo' },
  { ...BASE, id: 'feat-done-001', title: 'Finished forever ago', status: 'done' },
  // A parent/subtask family…
  { ...BASE, id: 'feat-epic-001', title: 'Epic root', status: 'todo' },
  { ...BASE, id: 'feat-epic-sub-001', title: 'Epic child', status: 'todo', parent_task: 'feat-epic-001' },
  // …and a research→plan→implement chain stitched by depends_on.
  { ...BASE, id: 'feat-chain-research-001', title: 'Chain research', status: 'review' },
  { ...BASE, id: 'feat-chain-plan-001', title: 'Chain plan', status: 'todo', depends_on: ['feat-chain-research-001'] },
  { ...BASE, id: 'feat-chain-impl-001', title: 'Chain implement', status: 'todo', depends_on: ['feat-chain-plan-001'] },
];

test.describe('List view rework', () => {
  let putBodies;

  test.beforeEach(async ({ page }) => {
    putBodies = [];
    await mockCoreApi(page);
    await page.route('**/api/tasks', (route) => route.fulfill({ json: TASKS }));
    await page.route('**/api/tasks/*', (route) => {
      if (route.request().method() === 'PUT') {
        putBodies.push({ url: route.request().url(), body: route.request().postDataJSON() });
        return route.fulfill({ json: { success: true, task: TASKS[0] } });
      }
      return route.fulfill({ json: TASKS[0] });
    });
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'list' } });
  });

  test('first open groups by status in lifecycle order with Done collapsed', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('list-group-by')).toHaveValue('status');

    // Lifecycle order: the first group header is To Do (no drafts seeded).
    const headers = page.locator('tbody tr', { hasText: /\d+ tasks/ });
    await expect(headers.first()).toContainText('To Do');

    // Done group exists as a header but its rows start collapsed.
    const doneHeader = headers.filter({ hasText: 'Done' }).first();
    await expect(doneHeader).toBeVisible();
    await expect(page.getByText('Finished forever ago')).toBeHidden();
    // Expanding brings the row back.
    await doneHeader.click();
    await expect(page.getByText('Finished forever ago')).toBeVisible();
  });

  test('Thread grouping renders the family tree AND the depends_on chain', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('list-group-by').selectOption('thread');

    // Family: root above its child.
    const rows = page.locator('[data-row-id]');
    const rowIds = await rows.evaluateAll(els => els.map(e => e.getAttribute('data-row-id')));
    const epicIdx = rowIds.indexOf('feat-epic-001');
    const childIdx = rowIds.indexOf('feat-epic-sub-001');
    expect(epicIdx).toBeGreaterThanOrEqual(0);
    expect(childIdx).toBe(epicIdx + 1);

    // Chain: research → plan → implement, stitched purely by depends_on.
    const rIdx = rowIds.indexOf('feat-chain-research-001');
    expect(rowIds[rIdx + 1]).toBe('feat-chain-plan-001');
    expect(rowIds[rIdx + 2]).toBe('feat-chain-impl-001');

    // Unconnected tasks sit in their own bucket.
    await expect(page.getByText('Not in a thread')).toBeVisible();
  });

  test('the id chip lives in the title cell and copies', async ({ page }) => {
    await page.goto('/');
    const chip = page.getByRole('button', { name: 'Copy task id feat-alpha-001' });
    await expect(chip).toBeVisible();
    await chip.click();
    // Click must not open the task detail (stopPropagation contract).
    await expect(page.getByTestId('depends-on-editor')).toHaveCount(0);
  });

  test('inline status change fires a PUT through the shared Select', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Status of feat-alpha-001').selectOption('review');
    await expect.poll(() => putBodies.length).toBeGreaterThan(0);
    expect(putBodies[0].url).toContain('feat-alpha-001');
    expect(putBodies[0].body.status).toBe('review');
  });

  test('keyboard: arrows walk visible rows, Enter opens the detail pane', async ({ page }) => {
    await page.goto('/');
    const region = page.getByRole('region', { name: /Task list/ });
    await region.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // First visible row under the To Do group opens in the side pane.
    await expect(page.getByTestId('depends-on-editor')).toBeVisible({ timeout: 15000 });
  });

  test('mobile renders cards, not a sideways table', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto('/'); // taskBoardView is seeded to 'list'
    await expect(page.getByTestId('list-mobile')).toBeVisible();
    await expect(page.getByTestId('list-card').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('zero tasks shows the create CTA instead of a dead end', async ({ page }) => {
    await page.route('**/api/tasks', (route) => route.fulfill({ json: [] }));
    await page.goto('/');
    await expect(page.getByTestId('list-empty-create')).toBeVisible();
  });
});
