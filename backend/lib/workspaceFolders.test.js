// Physical workspace-folder mutations (feat-workspace-folders-impl-001):
// archive/unarchive round-trips through the nested tree, setWorkspace moves
// the project directory, workspace rename moves the workspace directory,
// and syncWithDisk registers discovered folders into the right workspace.

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-wf-test-'));
process.env.ATRIUM_DATA_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert');

const projects = require('./projectRegistry');
const workspaces = require('./workspaceRegistry');
const { TASKS_DIR, ARCHIVED_DIR, WORKSPACES_FILE, PROJECTS_FILE } = require('./constants');

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const reset = (workspacesJson, projectsJson) => {
  // Wipe the whole tasks tree between tests — these tests create real dirs.
  for (const entry of fs.readdirSync(TASKS_DIR)) {
    fs.rmSync(path.join(TASKS_DIR, entry), { recursive: true, force: true });
  }
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspacesJson), 'utf8');
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projectsJson), 'utf8');
};

const WS = { personal: { name: 'Personal', order: 0 }, work: { name: 'Work', order: 1 } };

const seedProject = (wsDir, folder, taskId) => {
  const dir = path.join(TASKS_DIR, wsDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${taskId}.md`), `---\nid: ${taskId}\ntitle: T\n---\nbody\n`, 'utf8');
  return dir;
};

test('setWorkspace physically moves the project folder and its files', () => {
  reset(WS, { atb: { name: 'Atrium', folder: 'Atrium', workspace: 'personal' } });
  seedProject('Personal', 'Atrium', 'feat-wf-001');

  assert.strictEqual(projects.setWorkspace('atb', 'work'), true);
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Work', 'Atrium', 'feat-wf-001.md')));
  assert.ok(!fs.existsSync(path.join(TASKS_DIR, 'Personal', 'Atrium')));
  assert.strictEqual(JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')).atb.workspace, 'work');
});

test('setWorkspace refuses to clobber an existing destination', () => {
  reset(WS, { atb: { name: 'Atrium', folder: 'Atrium', workspace: 'personal' } });
  seedProject('Personal', 'Atrium', 'feat-wf-001');
  seedProject('Work', 'Atrium', 'feat-wf-002'); // conflicting residue

  assert.strictEqual(projects.setWorkspace('atb', 'work'), false);
  // Source untouched, registry unchanged.
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Personal', 'Atrium', 'feat-wf-001.md')));
  assert.strictEqual(JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')).atb.workspace, 'personal');
});

test('archive takes the nested source; unarchive restores into the CURRENT workspace', () => {
  reset(WS, { atb: { name: 'Atrium', folder: 'Atrium', workspace: 'personal' } });
  seedProject('Personal', 'Atrium', 'feat-wf-001');

  projects.archive('atb');
  assert.ok(fs.existsSync(path.join(ARCHIVED_DIR, 'Atrium', 'feat-wf-001.md')));
  assert.ok(!fs.existsSync(path.join(TASKS_DIR, 'Personal', 'Atrium')));

  // Reassign while archived (no folder on the active side — registry-only).
  assert.strictEqual(projects.setWorkspace('atb', 'work'), true);

  projects.unarchive('atb');
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Work', 'Atrium', 'feat-wf-001.md')));
  assert.ok(!fs.existsSync(path.join(ARCHIVED_DIR, 'Atrium')));
});

test('workspace rename renames the on-disk directory', () => {
  reset(WS, { atb: { name: 'Atrium', folder: 'Atrium', workspace: 'work' } });
  seedProject('Work', 'Atrium', 'feat-wf-001');

  assert.strictEqual(workspaces.rename('work', 'Client Work'), true);
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Client-Work', 'Atrium', 'feat-wf-001.md')));
  assert.ok(!fs.existsSync(path.join(TASKS_DIR, 'Work')));
});

test('workspace remove cleans up an empty directory but never a non-empty one', () => {
  reset(WS, {});
  fs.mkdirSync(path.join(TASKS_DIR, 'Work'), { recursive: true });
  assert.deepStrictEqual(workspaces.remove('work'), { ok: true });
  assert.ok(!fs.existsSync(path.join(TASKS_DIR, 'Work')));

  reset(WS, {});
  fs.mkdirSync(path.join(TASKS_DIR, 'Work'), { recursive: true });
  fs.writeFileSync(path.join(TASKS_DIR, 'Work', 'stray.md'), 'x', 'utf8');
  assert.deepStrictEqual(workspaces.remove('work'), { ok: true });
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Work', 'stray.md'))); // left alone
});

test('syncWithDisk registers {folder, workspace} entries into the owning workspace', () => {
  reset(WS, {});
  projects.syncWithDisk([
    { folder: 'Alpha', workspace: 'personal' },
    { folder: 'Beta', workspace: 'work' },
    'LegacyString',
  ]);
  const reg = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  const byFolder = Object.values(reg).reduce((m, p) => ({ ...m, [p.folder]: p }), {});
  assert.strictEqual(byFolder.Alpha.workspace, 'personal');
  assert.strictEqual(byFolder.Beta.workspace, 'work');
  assert.strictEqual(byFolder.LegacyString.workspace, 'personal');
});
