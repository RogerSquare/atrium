import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// feat-project-hub-impl-001 — the Files view: per-project roots with honest
// unlinked states, one-fetch-per-directory lazy tree, text preview with a
// blocked-state fallback, and the show-ignored toggle. Fully mocked API.

const PROJECTS = {
  configured: true,
  projects: [
    { id: 'alpha', project: 'Alpha', folder: 'Alpha', linked: true, source: 'name-match' },
    { id: 'ghost', project: 'Ghost', folder: 'Ghost', linked: false, source: null },
  ],
};

test.describe('Files view', () => {
  let listCalls;

  test.beforeEach(async ({ page }) => {
    listCalls = [];
    await mockCoreApi(page);
    await page.route('**/api/files/projects', (route) => route.fulfill({ json: PROJECTS }));
    await page.route('**/api/files/list**', (route) => {
      const url = new URL(route.request().url());
      listCalls.push(url.search);
      const p = url.searchParams.get('path') || '';
      if (p === '') {
        return route.fulfill({ json: { path: '', entries: [
          { name: 'src', type: 'dir', size: null, mtime: 1, ignored: false },
          { name: 'README.md', type: 'file', size: 1234, mtime: 1, ignored: false },
          ...(url.searchParams.get('all') === '1' ? [{ name: 'node_modules', type: 'dir', size: null, mtime: 1, ignored: true }] : []),
        ] } });
      }
      if (p === 'src') {
        return route.fulfill({ json: { path: 'src', entries: [
          { name: 'index.js', type: 'file', size: 42, mtime: 1, ignored: false },
        ] } });
      }
      return route.fulfill({ json: { path: p, entries: [] } });
    });
    await page.route('**/api/files/content**', (route) => {
      const url = new URL(route.request().url());
      const p = url.searchParams.get('path') || '';
      if (p.endsWith('.bin')) {
        return route.fulfill({ status: 415, json: { error: 'Binary file — download it instead' } });
      }
      if (p.endsWith('.md')) {
        return route.fulfill({ contentType: 'text/plain', body: '# Readme heading\n\nhello from preview' });
      }
      return route.fulfill({ contentType: 'text/plain', body: 'hello from preview' });
    });
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'files' } });
    await page.goto('/');
  });

  test('roots render with linked and unlinked states', async ({ page }) => {
    await expect(page.getByTestId('files-view')).toBeVisible();
    const roots = page.getByTestId('files-project-root');
    await expect(roots).toHaveCount(2);
    await expect(page.getByTestId('files-unlinked')).toBeVisible(); // Ghost
    await expect(page.getByTestId('files-zip')).toHaveCount(1);     // only linked projects zip
  });

  test('lazy tree: one fetch per expanded directory, files preview on click', async ({ page }) => {
    await page.getByText('Alpha', { exact: true }).click();      // expand root
    await expect(page.getByText('README.md')).toBeVisible();
    expect(listCalls.filter((s) => !s.includes('path=src'))).toHaveLength(1);

    await page.getByText('src', { exact: true }).click();        // expand child dir
    await expect(page.getByText('index.js')).toBeVisible();

    await page.getByText('README.md').click();
    await expect(page.getByTestId('files-preview')).toContainText('hello from preview');
    await expect(page.getByTestId('files-download')).toBeVisible();
  });

  test('markdown files render formatted, with a raw-source toggle', async ({ page }) => {
    await page.getByText('Alpha', { exact: true }).click();
    await page.getByText('README.md').click();

    // Rendered by default: the # heading becomes a real heading element.
    const rendered = page.getByTestId('files-md-rendered');
    await expect(rendered.getByRole('heading', { name: 'Readme heading' })).toBeVisible();

    // Toggle to raw: literal markdown source, no rendered container.
    await page.getByTestId('files-md-raw-toggle').click();
    await expect(page.getByTestId('files-md-rendered')).toHaveCount(0);
    await expect(page.getByTestId('files-preview')).toContainText('# Readme heading');

    // Non-markdown files never get the toggle.
    await page.getByText('src', { exact: true }).click();
    await page.getByText('index.js').click();
    await expect(page.getByTestId('files-md-raw-toggle')).toHaveCount(0);
  });

  test('show-ignored toggle refetches and reveals dimmed dirs', async ({ page }) => {
    await page.getByText('Alpha', { exact: true }).click();
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('node_modules')).toHaveCount(0);

    await page.getByTestId('files-show-ignored').click();
    await expect(page.getByText('node_modules')).toBeVisible();
    expect(listCalls.some((s) => s.includes('all=1'))).toBe(true);
  });

  test('active project scopes the roots', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'files', opusBoardActiveProject: 'Alpha' } });
    await page.goto('/');
    await expect(page.getByTestId('files-project-root')).toHaveCount(1);
    await expect(page.getByText('Ghost')).toHaveCount(0);
  });
});
