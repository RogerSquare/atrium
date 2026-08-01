import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// ui-tests-tab-generic-001 — the Tests tab renders ANY runner's normalized
// run (suite/source chips, generic artifact list, no Playwright assumptions),
// and the card-level tests badge only appears when a task has run data or its
// project declares suites. Fully mocked API.

const JUNIT_RUN = {
  run_id: '2026-08-01T00-00-00-000Z',
  started_at: '2026-08-01T00:00:00.000Z',
  duration_ms: 42,
  total: 4, passed: 3, failed: 1, skipped: 0, flaky: 0,
  source: 'junit-xml',
  suite: 'swift-unit',
  specs: [
    { file: 'SwiftDemoTests.CalculatorTests', title: 'testAddition', status: 'passed', duration_ms: 10, error: null, attachments: [] },
    { file: 'SwiftDemoTests.CalculatorTests', title: 'testDivision', status: 'passed', duration_ms: 12, error: null, attachments: [] },
    { file: 'SwiftDemoTests.CalculatorTests', title: 'testDivisionByZeroIsNil', status: 'passed', duration_ms: 8, error: null, attachments: [] },
    { file: 'SwiftDemoTests.CalculatorTests', title: 'testFailsWhenAsked', status: 'failed', duration_ms: 12, error: 'DEMO_FAIL=1 — intentional failure to prove the red path', attachments: [] },
  ],
};

const TESTED_TASK = {
  id: 'feat-swifty-001', title: 'Swift tested task', status: 'in_progress', priority: 'high',
  project: 'Lumeo', type: 'backend', tags: [], files_affected: [], depends_on: [],
  activity_log: [], content: '### Description\nx\n\n### Comments', assignee: null,
  e2e_status: 'failing', e2e_suite: 'swift-unit', e2e_run: JUNIT_RUN,
};
const PLAIN_TASK = {
  id: 'feat-plain-001', title: 'Untested plain task', status: 'todo', priority: 'medium',
  project: 'NoTests', type: 'frontend', tags: [], files_affected: [], depends_on: [],
  activity_log: [], content: '', assignee: null, e2e_status: null, e2e_run: null,
};

const SUITES = {
  project: 'Lumeo', declared: true,
  suites: [
    { id: 'swift-unit', label: 'Swift unit tests', report: 'junit-xml', target: 'container' },
    { id: 'swift-unit-fail-demo', label: 'Red-path demo', report: 'junit-xml', target: 'container' },
  ],
};

async function mockWorld(page, { suitesByProject = {} } = {}) {
  await mockCoreApi(page);
  await page.route('**/api/projects**', (route) => route.fulfill({
    json: [{ id: 'lum', name: 'Lumeo', folder: 'Lumeo' }, { id: 'nt', name: 'NoTests', folder: 'NoTests' }],
  }));
  await page.route('**/api/tasks', (route) => route.fulfill({ json: [TESTED_TASK, PLAIN_TASK] }));
  await page.route('**/api/runners/suites**', (route) => {
    const project = new URL(route.request().url()).searchParams.get('project');
    const hit = suitesByProject[project];
    return route.fulfill({ json: hit || { project, suites: [], declared: false } });
  });
  await page.route('**/api/e2e-runs/feat-swifty-001/*/files', (route) => route.fulfill({
    json: { files: [{ path: 'junit.xml', size: 812 }, { path: 'job-output.log', size: 20480 }] },
  }));
}

test.describe('Generic Tests tab + conditional badge', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'board' } });
  });

  test('a junit run renders summary, provenance, error text, and artifact links — no video', async ({ page }) => {
    await mockWorld(page, { suitesByProject: { Lumeo: SUITES } });
    await page.goto('/');

    await page.getByText('Swift tested task').click();
    await page.getByRole('tab', { name: 'Tests' }).click();

    await expect(page.getByText('3/4 passed')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('swift-unit', { exact: true })).toBeVisible();
    await expect(page.getByText('junit-xml', { exact: true })).toBeVisible();
    await expect(page.getByText('DEMO_FAIL=1 — intentional failure to prove the red path')).toBeVisible();

    const artifacts = page.getByTestId('run-artifact-link');
    await expect(artifacts).toHaveCount(2);
    await expect(artifacts.first()).toContainText('junit.xml');
    await expect(page.locator('video')).toHaveCount(0);
  });

  test('suite selector appears for multi-suite projects and updates the run hint', async ({ page }) => {
    await mockWorld(page, { suitesByProject: { Lumeo: SUITES } });
    await page.goto('/');
    await page.getByText('Swift tested task').click();
    await page.getByRole('tab', { name: 'Tests' }).click();

    const selector = page.getByTestId('tests-suite-selector');
    await expect(selector).toBeVisible({ timeout: 20_000 });
    await selector.selectOption('swift-unit-fail-demo');
    await expect(page.getByText('suite: "swift-unit-fail-demo"')).toBeVisible();
  });

  test('badge: run data shows the real status; no data + undeclared project shows nothing', async ({ page }) => {
    await mockWorld(page);
    await page.goto('/');

    await expect(page.getByLabel('tests: failing')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/tests: pending/)).toHaveCount(0);
  });

  test('badge: a declared project shows pending on unrun tasks once visited', async ({ page }) => {
    await mockWorld(page, {
      suitesByProject: { NoTests: { project: 'NoTests', declared: true, suites: [{ id: 'unit', label: 'Unit', report: 'junit-xml', target: 'local' }] } },
    });
    await page.goto('/');
    // Scope to the project so the shell fetches its suite declaration.
    await page.getByRole('button', { name: /All projects/ }).click();
    await page.getByRole('option', { name: /NoTests/ }).click();
    await expect(page.getByLabel('tests: pending')).toBeVisible({ timeout: 20_000 });
  });

  test('empty state names the declared suites instead of assuming Playwright', async ({ page }) => {
    await mockWorld(page, {
      suitesByProject: { NoTests: { project: 'NoTests', declared: true, suites: [{ id: 'unit', label: 'Unit', report: 'junit-xml', target: 'local' }] } },
    });
    await page.goto('/');
    await page.getByText('Untested plain task').click();
    await page.getByRole('tab', { name: 'Tests' }).click();

    await expect(page.getByText('No test runs yet for this task.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('tests-empty-suites')).toContainText('unit');
    await expect(page.getByText('atrium_run_tests')).toBeVisible();
  });
});
