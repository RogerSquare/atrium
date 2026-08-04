import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// feat-project-hub-impl-001 — the Hub merges the Loops and Demos views into
// one top-bar entry with sub-tabs; feat-hub-rethink-impl-001 adds the
// Overview landing tab (automation cards + merged activity feed). Legacy
// stored view ids ('loops'/'demos') migrate to Hub + the matching sub-tab.
// Fully mocked API.

const LOOPS = [
  {
    id: 'loop-digest', name: 'Morning digest', scope: 'project', project: 'Alpha',
    mode: 'playbook', watch: ['prs', 'ci'], actions: ['comment'], interval_ms: 300000,
    schedule: { time: '09:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, enabled: true,
    status: 'idle', last_run_at: null, next_run_at: null,
    last_result: { playbook_run_id: 'run-1', status: 'done', cost_usd: 0.12 }, last_error: null,
  },
  {
    id: 'loop-watch', name: 'PR watcher', scope: 'project', project: 'Beta',
    mode: 'watcher', watch: ['prs'], actions: ['comment'], interval_ms: 300000,
    schedule: null, enabled: true, status: 'idle', last_run_at: null, next_run_at: null,
    last_result: { changes: 2 }, last_error: null,
  },
];

test.describe('Hub view', () => {
  test.beforeEach(async ({ page }) => {
    await mockCoreApi(page); // already answers /api/loops with [] and core endpoints
    await page.route('**/api/demos/grouped', (route) => route.fulfill({ json: [] }));
  });

  test('opens on the Overview by default and switches to Demos', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'hub' } });
    await page.goto('/');

    await expect(page.getByTestId('hub-view')).toBeVisible();
    await expect(page.getByTestId('hub-overview')).toBeVisible();

    await page.getByTestId('hub-tab-demos').click();
    await expect(page.getByTestId('demos-view')).toBeVisible();
    await expect(page.getByTestId('hub-overview')).toHaveCount(0);

    // The choice persists across a reload.
    await page.reload();
    await expect(page.getByTestId('demos-view')).toBeVisible();
  });

  test('Overview shows automation cards with trigger + last result, card opens the cockpit', async ({ page }) => {
    await page.route('**/api/loops', (route) => route.fulfill({ json: LOOPS }));
    await page.route('**/api/loops/activity**', (route) => route.fulfill({ json: [
      { id: 'act-1', loop_id: 'loop-digest', ts: new Date().toISOString(), type: 'playbook_run', message: 'Playbook run (schedule) — done · $0.12', refs: {} },
    ] }));
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'hub', taskBoardHubTab: 'overview' } });
    await page.goto('/');

    const cards = page.getByTestId('hub-loop-card');
    await expect(cards).toHaveCount(2);
    const digest = cards.filter({ hasText: 'Morning digest' });
    await expect(digest.getByText('weekdays 09:00')).toBeVisible();       // schedule-aware trigger
    await expect(digest.getByTestId('hub-loop-last')).toContainText('playbook run done');
    await expect(page.getByTestId('hub-activity-feed')).toContainText('Morning digest');

    // Card click lands on the Loops tab with that loop's cockpit open.
    await digest.click();
    await expect(page.getByTestId('loops-view')).toBeVisible();
    await expect(page.getByTestId('loop-detail')).toBeVisible();
    await expect(page.getByTestId('loop-detail')).toContainText('Morning digest');
  });

  test('Overview scopes to the active project', async ({ page }) => {
    await page.route('**/api/loops', (route) => route.fulfill({ json: LOOPS }));
    await page.route('**/api/loops/activity**', (route) => route.fulfill({ json: [] }));
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'hub', taskBoardHubTab: 'overview', opusBoardActiveProject: 'Alpha' } });
    await page.goto('/');

    await expect(page.getByTestId('hub-loop-card')).toHaveCount(1);
    await expect(page.getByText('PR watcher')).toHaveCount(0);
  });

  test('a stored legacy view id migrates to Hub + the right sub-tab', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'demos' } });
    await page.goto('/');

    await expect(page.getByTestId('hub-view')).toBeVisible();
    await expect(page.getByTestId('demos-view')).toBeVisible();
    const migrated = await page.evaluate(() => [localStorage.getItem('taskBoardView'), localStorage.getItem('taskBoardHubTab')]);
    expect(migrated).toEqual(['hub', 'demos']);
  });

  test('the top bar has a Hub entry and no Loops/Demos entries', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Hub', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Loops', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Demos', exact: true })).toHaveCount(0);
  });
});
