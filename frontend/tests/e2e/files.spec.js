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
      if (p.endsWith('.js')) {
        return route.fulfill({ contentType: 'text/plain', body: 'const hello = "from preview";\n' });
      }
      return route.fulfill({ contentType: 'text/plain', body: 'hello from preview' });
    });
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'files' } });
    await page.goto('/');
  });

  test('roots render with linked and unlinked states, linked roots open by default', async ({ page }) => {
    await expect(page.getByTestId('files-view')).toBeVisible();
    const roots = page.getByTestId('files-project-root');
    await expect(roots).toHaveCount(2);
    await expect(page.getByTestId('files-unlinked')).toBeVisible(); // Ghost
    await expect(page.getByTestId('files-zip')).toHaveCount(1);     // only linked projects zip
    // feat-files-tasks-impl-001: linked roots start expanded.
    await expect(page.getByText('README.md')).toBeVisible();
  });

  test('lazy tree: one fetch per expanded directory, files preview on click', async ({ page }) => {
    await expect(page.getByText('README.md')).toBeVisible();     // root auto-expanded
    expect(listCalls.filter((s) => !s.includes('path=src'))).toHaveLength(1);

    await page.getByText('src', { exact: true }).click();        // expand child dir
    await expect(page.getByText('index.js')).toBeVisible();

    await page.getByText('README.md').click();
    await expect(page.getByTestId('files-preview')).toContainText('hello from preview');
    await expect(page.getByTestId('files-download')).toBeVisible();
  });

  test('a collapsed root stays collapsed across a reload', async ({ page }) => {
    await expect(page.getByText('README.md')).toBeVisible();
    await page.getByText('Alpha', { exact: true }).click();      // explicit collapse
    await expect(page.getByText('README.md')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('files-view')).toBeVisible();
    await expect(page.getByTestId('files-project-root')).toHaveCount(2);
    await expect(page.getByText('README.md')).toHaveCount(0);    // choice remembered

    await page.getByText('Alpha', { exact: true }).click();      // re-open works
    await expect(page.getByText('README.md')).toBeVisible();
  });

  test('markdown files render formatted, with a raw-source toggle', async ({ page }) => {
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
    await expect(page.getByText('README.md')).toBeVisible();     // root auto-expanded
    await expect(page.getByText('node_modules')).toHaveCount(0);

    await page.getByTestId('files-show-ignored').click();
    await expect(page.getByText('node_modules')).toBeVisible();
    expect(listCalls.some((s) => s.includes('all=1'))).toBe(true);
  });

  test('task history: tree badges, touched-by panel, honest unmatched note', async ({ page }) => {
    const TASK = {
      id: 'feat-hist-001', title: 'History probe', status: 'review', priority: 'medium',
      project: 'Alpha', type: 'backend', tags: [], depends_on: [],
      files_affected: ['src/index.js', 'old-prefix/gone.md'],
      activity_log: [{ timestamp: new Date().toISOString(), action: 'x' }],
      content: '### Description\nx\n\n### Comments\n', assignee: null,
    };
    await page.route('**/api/tasks', (r) => r.fulfill({ json: [TASK] }));
    await page.route('**/api/tasks/*', (r) => r.fulfill({ json: TASK }));
    await page.route('**/api/files/resolve-paths**', (r) => r.fulfill({ json: {
      resolutions: { 'src/index.js': 'src/index.js', 'old-prefix/gone.md': null },
    } }));
    await page.goto('/');

    // The src dir carries a count badge before it's even expanded.
    await expect(page.getByTestId('files-task-count').first()).toHaveText('1');

    // Honest unmatched note, expandable to the task→path pair.
    const note = page.getByTestId('files-unmatched-note');
    await expect(note).toContainText('1 history entry');
    await note.getByRole('button').first().click();
    await expect(note.getByText('old-prefix/gone.md')).toBeVisible();

    // Open the file: the touched-by panel lists the task and navigates to it.
    await page.getByText('src', { exact: true }).click();
    await page.getByText('index.js').click();
    const panel = page.getByTestId('files-touched-by');
    await expect(panel).toContainText('Change History by 1 task');
    // Minimized by default (ui-files-preview-001) — expand to reach the chips.
    await expect(panel.getByTestId('files-touched-task')).toHaveCount(0);
    await panel.getByTestId('files-touched-toggle').click();
    await expect(panel).toContainText('feat-hist-001');
    await panel.getByTestId('files-touched-task').click();
    await expect(page.getByTestId('detail-pane')).toBeVisible();
  });

  test('a task chip with a PR shows its per-file diff, then returns to current content', async ({ page }) => {
    const TASK = {
      id: 'feat-diff-001', title: 'Diff probe', status: 'done', priority: 'medium',
      project: 'Alpha', type: 'backend', tags: [], depends_on: [],
      files_affected: ['src/index.js'], github_pr_url: 'https://github.com/x/y/pull/42',
      activity_log: [{ timestamp: new Date().toISOString(), action: 'x' }],
      content: '### Description\nx\n\n### Comments\n', assignee: null,
    };
    const NO_PR_TASK = { ...TASK, id: 'feat-nopr-001', title: 'No PR probe', github_pr_url: null };
    await page.route('**/api/tasks', (r) => r.fulfill({ json: [TASK, NO_PR_TASK] }));
    await page.route('**/api/files/resolve-paths**', (r) => r.fulfill({ json: {
      resolutions: { 'src/index.js': 'src/index.js' },
    } }));
    await page.route('**/api/files/pr-diff**', (r) => r.fulfill({ json: {
      pr_number: 42, filename: 'src/index.js', status: 'modified', additions: 2, deletions: 1,
      patch: '@@ -1,2 +1,3 @@\n-const old = 1\n+const hello = "from preview"\n+const added = 2',
    } }));
    await page.goto('/');

    await page.getByText('src', { exact: true }).click();
    await page.getByText('index.js').click();
    await page.getByTestId('files-touched-toggle').click();

    // Only the PR-linked task gets the diff affordance.
    await expect(page.getByTestId('files-diff-toggle')).toHaveCount(1);
    await page.getByTestId('files-diff-toggle').click();

    await expect(page.getByTestId('files-diff-header')).toContainText('PR #42 · +2 −1');
    const diffView = page.getByTestId('files-diff-view');
    await expect(diffView).toContainText('const added = 2');
    await expect(diffView).toContainText('const old = 1');

    // Back to the live file.
    await page.getByTestId('files-diff-back').click();
    await expect(page.getByTestId('files-diff-view')).toHaveCount(0);
    await expect(page.getByTestId('files-preview')).toContainText('from preview');
  });

  test('the not-in-tree warning is dismissible and stays dismissed across reloads', async ({ page }) => {
    const TASK = {
      id: 'feat-dis-001', title: 'Dismiss probe', status: 'todo', priority: 'medium',
      project: 'Alpha', type: 'backend', tags: [], depends_on: [],
      files_affected: ['old-prefix/gone.md'],
      activity_log: [], content: '### Description\nx\n\n### Comments\n', assignee: null,
    };
    await page.route('**/api/tasks', (r) => r.fulfill({ json: [TASK] }));
    await page.route('**/api/files/resolve-paths**', (r) => r.fulfill({ json: {
      resolutions: { 'old-prefix/gone.md': null },
    } }));
    await page.goto('/');

    const note = page.getByTestId('files-unmatched-note');
    await expect(note).toBeVisible();
    await note.getByTestId('files-unmatched-dismiss').click();
    await expect(note).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId('files-view')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible(); // tree rendered
    await expect(page.getByTestId('files-unmatched-note')).toHaveCount(0); // still dismissed
  });

  test('code previews are syntax highlighted for known languages', async ({ page }) => {
    await page.getByText('src', { exact: true }).click();
    await page.getByText('index.js').click();
    // The lazy chunk renders tokenized code; plain files never get the wrapper.
    await expect(page.getByTestId('files-code-highlighted')).toBeVisible();
    await expect(page.getByTestId('files-preview')).toContainText('from preview');
    const tokens = await page.getByTestId('files-code-highlighted').locator('.token').count();
    expect(tokens).toBeGreaterThan(0);
  });

  test('open task highlights its files: tint + auto-expand, ephemeral, clears on close', async ({ page }) => {
    const TASK = {
      id: 'feat-hl-001', title: 'Highlight probe', status: 'in_progress', priority: 'medium',
      project: 'Alpha', type: 'backend', tags: [], depends_on: [],
      files_affected: ['src/index.js', 'old-prefix/gone.md'],
      activity_log: [{ timestamp: new Date().toISOString(), action: 'x' }],
      content: '### Description\nx\n\n### Comments\n', assignee: null,
    };
    await page.route('**/api/tasks', (r) => r.fulfill({ json: [TASK] }));
    await page.route('**/api/tasks/*', (r) => r.fulfill({ json: TASK }));
    await page.route('**/api/files/resolve-paths**', (r) => r.fulfill({ json: {
      resolutions: { 'src/index.js': 'src/index.js', 'old-prefix/gone.md': null },
    } }));
    await page.goto('/');
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('index.js')).toHaveCount(0); // src starts collapsed

    // Open the task (via the unmatched note's task row) — highlights engage.
    await page.getByTestId('files-unmatched-note').getByRole('button').first().click();
    await page.getByTestId('files-unmatched-note').getByText('feat-hl-001').click();
    await expect(page.getByTestId('detail-pane')).toBeVisible();

    const chip = page.getByTestId('files-highlight-chip');
    await expect(chip).toContainText('highlighting 1 file from feat-hl-001');
    await expect(chip).toContainText('1 not in tree');
    await expect(page.getByText('index.js')).toBeVisible();        // src auto-expanded
    await expect(page.getByTestId('files-highlighted')).toHaveCount(1);

    // Ephemeral: the auto-expansion never reached the persisted choices.
    const stored = await page.evaluate(() => localStorage.getItem('taskBoardFilesExpanded') || '{}');
    expect(JSON.parse(stored)['Alpha:src']).toBeUndefined();

    // Closing the task clears the highlights and the chip.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-pane')).toHaveCount(0);
    await expect(page.getByTestId('files-highlight-chip')).toHaveCount(0);
    await expect(page.getByTestId('files-highlighted')).toHaveCount(0);
  });

  test('active project scopes the roots', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { taskBoardView: 'files', opusBoardActiveProject: 'Alpha' } });
    await page.goto('/');
    await expect(page.getByTestId('files-project-root')).toHaveCount(1);
    await expect(page.getByText('Ghost')).toHaveCount(0);
  });
});
