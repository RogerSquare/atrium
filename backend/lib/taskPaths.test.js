// taskPaths — the single owner of the nested tasks/<Workspace>/<Project>
// layout rules (feat-workspace-folders-impl-001). Real temp data dir, same
// per-process ATRIUM_DATA_DIR pattern as workspaceRegistry.test.js.

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-tp-test-'));
process.env.ATRIUM_DATA_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert');

const { workspaceDirName, sanitizeWorkspaceDirName, projectTaskDir, deriveProject } = require('./taskPaths');
const workspaces = require('./workspaceRegistry');
const { TASKS_DIR, WORKSPACES_FILE, PROJECTS_FILE } = require('./constants');

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const reset = (workspacesJson, projectsJson) => {
  if (workspacesJson === undefined) fs.rmSync(WORKSPACES_FILE, { force: true });
  else fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspacesJson), 'utf8');
  if (projectsJson === undefined) fs.rmSync(PROJECTS_FILE, { force: true });
  else fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projectsJson), 'utf8');
};

test('sanitizeWorkspaceDirName matches project-folder sanitization and falls back to the id', () => {
  assert.strictEqual(sanitizeWorkspaceDirName('Personal', 'personal'), 'Personal');
  assert.strictEqual(sanitizeWorkspaceDirName('Open Source Forks', 'osf'), 'Open-Source-Forks');
  assert.strictEqual(sanitizeWorkspaceDirName('a/b\\c', 'x'), 'a-b-c');
  assert.strictEqual(sanitizeWorkspaceDirName('🎉🎉', 'party'), 'party');
});

test('workspaceDirName resolves through the registry, unknown ids fall back to the default', () => {
  reset({ personal: { name: 'Personal', order: 0 }, work: { name: 'Client Work', order: 1 } });
  assert.strictEqual(workspaceDirName('work'), 'Client-Work');
  assert.strictEqual(workspaceDirName('personal'), 'Personal');
  assert.strictEqual(workspaceDirName('missing'), 'Personal');
});

test('projectTaskDir: Root at top level, registered folders under their workspace, unknown under default', () => {
  reset(
    { personal: { name: 'Personal', order: 0 }, work: { name: 'Work', order: 1 } },
    { atb: { name: 'Atrium', folder: 'Atrium', workspace: 'work' } },
  );
  assert.strictEqual(projectTaskDir('Root'), TASKS_DIR);
  assert.strictEqual(projectTaskDir('Atrium'), path.join(TASKS_DIR, 'Work', 'Atrium'));
  assert.strictEqual(projectTaskDir('Unregistered'), path.join(TASKS_DIR, 'Personal', 'Unregistered'));
});

test('deriveProject: depth 0 → Root, depth 2 → leaf, depth 1 → registered folder or Root', () => {
  reset(
    { personal: { name: 'Personal', order: 0 } },
    { leg: { name: 'Legacy', folder: 'Legacy', workspace: 'personal' } },
  );
  assert.strictEqual(deriveProject(path.join(TASKS_DIR, 'feat-x-001.md')), 'Root');
  assert.strictEqual(deriveProject(path.join(TASKS_DIR, 'Personal', 'Atrium', 'feat-x-001.md')), 'Atrium');
  // Legacy flat project (pre-migration compat): depth-1 dir that IS a registered folder.
  assert.strictEqual(deriveProject(path.join(TASKS_DIR, 'Legacy', 'feat-x-001.md')), 'Legacy');
  // A stray file inside a workspace dir claims no project.
  assert.strictEqual(deriveProject(path.join(TASKS_DIR, 'Personal', 'feat-x-001.md')), 'Root');
});

test('workspace create/rename refuse directory-name collisions', () => {
  reset({ personal: { name: 'Personal', order: 0 } });
  const a = workspaces.create('Client Work');
  assert.ok(a);
  // Different display name, same sanitized directory.
  assert.strictEqual(workspaces.create('Client  Work'), null);
  const b = workspaces.create('Sandbox');
  assert.ok(b);
  assert.strictEqual(workspaces.rename(b.id, 'Client-Work'), false);
  assert.strictEqual(workspaces.rename(b.id, 'Playground'), true);
});
