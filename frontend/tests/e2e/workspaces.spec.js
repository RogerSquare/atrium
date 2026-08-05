import { test, expect } from '@playwright/test';
import { seedSession, mockCoreApi } from './helpers/session.js';

// Workspaces (feat-workspaces-impl-001): a workspace is an ISOLATION
// boundary above projects — the active workspace's projects and tasks are
// the entire visible world. These specs use stateful route mocks (closures
// over mutable arrays) so workspace switches and project moves round-trip
// through the same refetch path the real backend drives.

const NOW = new Date().toISOString();
const task = (id, project) => ({
  id, title: `Task ${id}`, status: 'todo', priority: 'medium', project, type: 'backend',
  tags: [], files_affected: [], depends_on: [], activity_log: [{ timestamp: NOW, action: 'x' }],
  content: '### Description\nx\n\n### Comments\n', assignee: null, created_at: NOW,
});

// Alpha lives in the default workspace, Beta in "Work". One Root task
// exercises the pinned-to-default rule.
function makeState() {
  return {
    workspaces: [
      { id: 'personal', name: 'Personal', order: 0 },
      { id: 'work', name: 'Work', order: 1 },
    ],
    projects: [
      { id: 'root', name: 'Root', folder: 'Root', workspace: 'personal', archived: false },
      { id: 'alpha', name: 'Alpha', folder: 'Alpha', workspace: 'personal', archived: false },
      { id: 'beta', name: 'Beta', folder: 'Beta', workspace: 'work', archived: false },
    ],
    tasks: [
      task('feat-ws-alpha-001', 'Alpha'),
      task('feat-ws-beta-001', 'Beta'),
      { ...task('feat-ws-root-001', undefined), project: 'Root' },
    ],
  };
}

async function mockWorkspaceApi(page, state) {
  // Registered AFTER mockCoreApi, so these win (reverse registration order).
  await page.route('**/api/tasks**', (route) => route.fulfill({ json: state.tasks }));
  await page.route('**/api/projects**', (route) => {
    const url = route.request().url();
    if (route.request().method() === 'GET') {
      const archived = url.includes('include=archived');
      return route.fulfill({ json: archived ? [] : state.projects });
    }
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/projects/*/workspace', (route) => {
    const idOrFolder = decodeURIComponent(route.request().url().match(/projects\/([^/]+)\/workspace/)[1]);
    const { workspace } = route.request().postDataJSON();
    const proj = state.projects.find((p) => p.id === idOrFolder || p.folder === idOrFolder);
    if (proj) proj.workspace = workspace;
    return route.fulfill({ json: { success: true, id: proj?.id, workspace } });
  });
  await page.route('**/api/workspaces', (route) => {
    if (route.request().method() === 'POST') {
      const { name } = route.request().postDataJSON();
      const ws = { id: name.toLowerCase().replace(/\s+/g, '-'), name, order: state.workspaces.length };
      state.workspaces.push(ws);
      return route.fulfill({ status: 201, json: { success: true, workspace: ws } });
    }
    return route.fulfill({ json: state.workspaces });
  });
  await page.route('**/api/workspaces/*', (route) => {
    const id = route.request().url().split('/').pop();
    if (route.request().method() === 'DELETE') {
      const count = state.projects.filter((p) => p.id !== 'root' && p.workspace === id).length;
      if (id === 'personal') {
        return route.fulfill({ status: 400, json: { error: 'Cannot delete the default workspace' } });
      }
      if (count > 0) {
        return route.fulfill({ status: 400, json: { error: `Workspace still has ${count} project${count === 1 ? '' : 's'} — move them first`, count } });
      }
      state.workspaces = state.workspaces.filter((w) => w.id !== id);
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: { success: true } });
  });
}

async function openAnchor(page) {
  // The trigger's accessible name is the current selection (e.g. "Alpha"),
  // so the stable hook is its title attribute.
  await page.getByTitle('Switch project (Cmd+P)').click();
}

test.describe('Workspaces', () => {
  let state;
  test.beforeEach(async ({ page }) => {
    state = makeState();
    await mockCoreApi(page);
    await mockWorkspaceApi(page, state);
  });

  test('defaults to Personal: its projects and Root tasks visible, Beta hidden', async ({ page }) => {
    await page.addInitScript(seedSession, {});
    await page.goto('/');

    // Personal world: Alpha + Root tasks, no Beta.
    await expect(page.getByText('Task feat-ws-alpha-001')).toBeVisible();
    await expect(page.getByText('Task feat-ws-root-001')).toBeVisible();
    await expect(page.getByText('Task feat-ws-beta-001')).toHaveCount(0);

    await openAnchor(page);
    await expect(page.getByTestId('workspace-switcher')).toContainText('Personal');
    await expect(page.getByRole('option', { name: /Alpha/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /No project/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Beta/ })).toHaveCount(0);
    // All-projects count is workspace-scoped: Alpha + Root, not Beta.
    await expect(page.getByTestId('project-anchor-all')).toContainText('2');
  });

  test('switching to Work swaps the whole visible world; Root stays behind', async ({ page }) => {
    await page.addInitScript(seedSession, {});
    await page.goto('/');
    await expect(page.getByText('Task feat-ws-alpha-001')).toBeVisible();

    await openAnchor(page);
    await page.getByTestId('workspace-switcher').click();
    await page.getByTestId('workspace-row-work').click();

    await expect(page.getByText('Task feat-ws-beta-001')).toBeVisible();
    await expect(page.getByText('Task feat-ws-alpha-001')).toHaveCount(0);
    // Root tasks are pinned to the default workspace — absent here.
    await expect(page.getByText('Task feat-ws-root-001')).toHaveCount(0);

    // The picker lists only Work's projects, and no "No project" row.
    await expect(page.getByRole('option', { name: /Beta/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Alpha/ })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /No project/ })).toHaveCount(0);
  });

  test('a stale project selection resets to All on switch, and the workspace persists across reload', async ({ page }) => {
    await page.addInitScript(seedSession, { storage: { opusBoardActiveProject: 'Alpha' } });
    await page.goto('/');
    await expect(page.getByText('Task feat-ws-alpha-001')).toBeVisible();

    await openAnchor(page);
    await page.getByTestId('workspace-switcher').click();
    await page.getByTestId('workspace-row-work').click();

    // Alpha belongs to Personal — the anchor falls back to All projects.
    await expect(page.getByRole('button', { name: /All projects/ })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Task feat-ws-beta-001')).toBeVisible();
    await expect(page.getByText('Task feat-ws-alpha-001')).toHaveCount(0);
    await openAnchor(page);
    await expect(page.getByTestId('workspace-switcher')).toContainText('Work');
  });

  test('moving a project to another workspace removes it from the current one', async ({ page }) => {
    await page.addInitScript(seedSession, {});
    await page.goto('/');
    await expect(page.getByText('Task feat-ws-alpha-001')).toBeVisible();

    await openAnchor(page);
    const alphaRow = page.getByRole('option', { name: /Alpha/ }).locator('..');
    await alphaRow.hover();
    await page.getByRole('button', { name: 'Move "Alpha" to another workspace' }).click();
    await page.getByTestId('move-project-to-work').click();

    // Alpha (and its tasks) leave the Personal world.
    await expect(page.getByText('Task feat-ws-alpha-001')).toHaveCount(0);
    await openAnchor(page);
    await expect(page.getByRole('option', { name: /Alpha/ })).toHaveCount(0);
  });

  test('create workspace inline; delete guards surface as toasts and Personal has no delete', async ({ page }) => {
    await page.addInitScript(seedSession, {});
    await page.goto('/');
    await expect(page.getByText('Task feat-ws-alpha-001')).toBeVisible();

    await openAnchor(page);
    await page.getByTestId('workspace-switcher').click();

    // Personal is undeletable — the row offers no delete affordance at all.
    await page.getByTestId('workspace-row-personal').hover();
    await expect(page.getByRole('button', { name: 'Delete "Personal"' })).toHaveCount(0);

    // Deleting a non-empty workspace is refused with the backend's count message.
    await page.getByTestId('workspace-row-work').hover();
    await page.getByRole('button', { name: 'Delete "Work"' }).click();
    await expect(page.getByText(/still has 1 project/)).toBeVisible();

    // Inline create adds a switchable row.
    await page.getByTestId('workspace-create').click();
    await page.getByTestId('workspace-create-input').fill('Originals');
    await page.getByTestId('workspace-create-input').press('Enter');
    await expect(page.getByTestId('workspace-row-originals')).toBeVisible();
  });
});
