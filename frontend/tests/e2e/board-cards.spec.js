import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-card-redesign-impl-001 — the three-zone task card: identity line with a
// single right-aligned signal cluster, title as the focal element, one calm
// metadata footer. Same information as the old six-zone card, plus a
// copyable id. Fully mocked API.

const DAYS = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const BASE = { priority: 'medium', project: 'Alpha', type: 'backend', tags: [], files_affected: [], depends_on: [], activity_log: [], content: '', assignee: null };
const TASKS = [
  // Everything-at-once card: waiting + agent + stale signals must coexist in
  // the cluster without breaking the layout.
  {
    ...BASE, id: 'feat-busy-001', title: 'Busy card with every signal', status: 'waiting_input',
    assignee: 'agent:claude', summary: 'Awaiting input · last: approval requested · 2m ago',
    parent_task: 'feat-epic-001', component: 'Auth', e2e_status: 'passing',
    content: '### Description\nx\n\n### Comments\n- a comment',
    activity_log: [{ timestamp: DAYS(10), action: 'x' }],
  },
  { ...BASE, id: 'feat-epic-001', title: 'Epic root task', status: 'in_progress', assignee: 'roger', activity_log: [{ timestamp: DAYS(10), action: 'x' }] },
  { ...BASE, id: 'feat-plain-001', title: 'Plain todo card', status: 'todo' },
  // The overflow regression case: a long id + done state + type dash must
  // all fit a narrow column (the first cut spilled type labels and the
  // done check outside the card).
  { ...BASE, id: 'devops-very-long-identifier-overflow-check-001', title: 'Done card with a very long id', status: 'done', e2e_status: 'passing' },
];

test.describe('Board card redesign', () => {
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
    await page.route('**/api/agents/active', (route) => route.fulfill({ json: [{ taskId: 'feat-busy-001' }] }));
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');
  });

  test('signal cluster carries needs-you + agent + type dashes together without breaking', async ({ page }) => {
    const busy = page.locator('[role="button"]', { hasText: 'Busy card with every signal' }).first();
    const cluster = busy.getByTestId('card-signal-cluster');
    await expect(cluster.getByTestId('card-waiting-indicator')).toBeVisible(); // yellow dash, pulsing
    await expect(cluster.getByTestId('card-type-dash')).toBeVisible();
    await expect(cluster.locator('.animate-spin')).toBeVisible(); // agent keeps its spinner
    const epic = page.locator('[role="button"]', { hasText: 'Epic root task' }).first();
    await expect(epic.getByTestId('card-signal-cluster')).toBeVisible();
  });

  test('no element escapes the card — long id + done dash + type dash all contained', async ({ page }) => {
    const long = page.getByLabel(/Done card with a very long id/);
    await expect(long).toBeVisible();
    const overflow = await long.evaluate((el) => ({
      x: el.scrollWidth - el.clientWidth,
      y: el.scrollHeight - el.clientHeight,
    }));
    expect(overflow.x).toBeLessThanOrEqual(0);
    expect(overflow.y).toBeLessThanOrEqual(0);
    // The id is truncated, not spilled; the full id stays reachable via the
    // copy button's accessible name.
    await expect(long.getByTestId('card-id-copy')).toBeVisible();
  });

  test('metadata footer keeps every fact: assignee, tests, component, parent, comments', async ({ page }) => {
    const busy = page.locator('[role="button"]', { hasText: 'Busy card with every signal' }).first();
    await expect(busy.getByText('agent:claude')).toBeVisible();
    await expect(busy.getByText('tests: passing')).toBeVisible();
    await expect(busy.getByText('Auth', { exact: true })).toBeVisible();
    const subtask = busy.getByTestId('card-subtask-chip');
    await expect(subtask).toBeVisible();
    await expect(subtask).toHaveAttribute('title', /feat-epic-001/); // parent id one hover away
    await expect(busy.getByText('Awaiting input', { exact: false })).toBeVisible(); // summary line
  });

  test('id chip copies without opening the detail pane', async ({ page }) => {
    const busy = page.locator('[role="button"]', { hasText: 'Busy card with every signal' }).first();
    await busy.getByTestId('card-id-copy').click();
    await expect(page.getByTestId('depends-on-editor')).toHaveCount(0);
  });

  test('priority glyph cycles medium → high via PUT', async ({ page }) => {
    const plain = page.locator('[role="button"]', { hasText: 'Plain todo card' }).first();
    await plain.getByTestId('card-priority-cycle').click();
    await expect.poll(() => putBodies.length).toBeGreaterThan(0);
    expect(putBodies[0].url).toContain('feat-plain-001');
    expect(putBodies[0].body.priority).toBe('high');
  });

  test('plain cards show no signal noise and no tests badge without run data', async ({ page }) => {
    const plain = page.locator('[role="button"]', { hasText: 'Plain todo card' }).first();
    await expect(plain.getByTestId('card-waiting-indicator')).toHaveCount(0);
    await expect(plain.getByText(/tests:/)).toHaveCount(0);
  });

  test('keyboard focus is visible (ring classes present, not outline-none only)', async ({ page }) => {
    // The card itself (not the dnd wrapper, which is also role=button) is
    // the element carrying the aria-label sentence.
    const plain = page.getByLabel(/Plain todo card, medium priority/);
    const cls = await plain.getAttribute('class');
    expect(cls).toContain('focus-visible:ring-2');
  });

  test('compact mode still renders single-line cards with state icons', async ({ page }) => {
    await page.getByRole('button', { name: 'Compact' }).click();
    const busy = page.locator('[role="button"]', { hasText: 'Busy card with every signal' }).first();
    await expect(busy).toBeVisible();
    // Compact keeps the waiting icon (HelpCircle) even without the chip.
    await expect(busy.locator('svg').first()).toBeVisible();
    // Zone-2 elements are gone in compact.
    await expect(busy.getByText('tests: passing')).toHaveCount(0);
  });
});
