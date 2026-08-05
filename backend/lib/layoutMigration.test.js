// Flat → nested layout migration (feat-workspace-folders-impl-001).

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-mig-test-'));
process.env.ATRIUM_DATA_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert');

const { migrateTasksLayout, MARKER } = require('./layoutMigration');
const { TASKS_DIR, WORKSPACES_FILE, PROJECTS_FILE } = require('./constants');

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const reset = (workspacesJson, projectsJson) => {
  for (const entry of fs.readdirSync(TASKS_DIR)) {
    fs.rmSync(path.join(TASKS_DIR, entry), { recursive: true, force: true });
  }
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspacesJson), 'utf8');
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projectsJson), 'utf8');
};

const seedFlat = (folder, taskId) => {
  const dir = path.join(TASKS_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${taskId}.md`), `---\nid: ${taskId}\n---\nx\n`, 'utf8');
};

const WS = { personal: { name: 'Personal', order: 0 }, work: { name: 'Work', order: 1 } };

test('migrates flat project folders into their workspace dirs, leaves Root files, writes the marker', () => {
  reset(WS, {
    atb: { name: 'Atrium', folder: 'Atrium', workspace: 'personal' },
    cai: { name: 'Cairn', folder: 'Cairn', workspace: 'work' },
  });
  seedFlat('Atrium', 'feat-m-001');
  seedFlat('Cairn', 'feat-m-002');
  fs.writeFileSync(path.join(TASKS_DIR, 'feat-root-001.md'), '---\nid: feat-root-001\n---\nx\n', 'utf8');

  const result = migrateTasksLayout();
  assert.strictEqual(result.migrated, 2);
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Personal', 'Atrium', 'feat-m-001.md')));
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Work', 'Cairn', 'feat-m-002.md')));
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'feat-root-001.md'))); // untouched
  assert.ok(fs.existsSync(MARKER));
});

test('second run is a no-op behind the marker', () => {
  // State carried from the previous test: marker present.
  seedFlat('Straggler', 'feat-m-003');
  const result = migrateTasksLayout();
  assert.strictEqual(result.alreadyDone, true);
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Straggler', 'feat-m-003.md'))); // untouched
});

test('an existing destination is skipped, never clobbered', () => {
  reset(WS, { atb: { name: 'Atrium', folder: 'Atrium', workspace: 'personal' } });
  seedFlat('Atrium', 'feat-m-004');
  // Conflicting residue already at the nested home.
  fs.mkdirSync(path.join(TASKS_DIR, 'Personal', 'Atrium'), { recursive: true });
  fs.writeFileSync(path.join(TASKS_DIR, 'Personal', 'Atrium', 'other.md'), 'x', 'utf8');

  const result = migrateTasksLayout();
  assert.strictEqual(result.skipped, 1);
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Atrium', 'feat-m-004.md'))); // flat copy intact
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Personal', 'Atrium', 'other.md')));
  assert.ok(fs.existsSync(MARKER)); // marker still written — remaining tree is valid
});

test('interrupted migration resumes: already-nested folders skip, flat remainder moves', () => {
  reset(WS, {
    atb: { name: 'Atrium', folder: 'Atrium', workspace: 'personal' },
    cai: { name: 'Cairn', folder: 'Cairn', workspace: 'personal' },
  });
  // Atrium already migrated (as if the process died mid-way, pre-marker).
  fs.mkdirSync(path.join(TASKS_DIR, 'Personal', 'Atrium'), { recursive: true });
  fs.writeFileSync(path.join(TASKS_DIR, 'Personal', 'Atrium', 'feat-m-005.md'), 'x', 'utf8');
  seedFlat('Cairn', 'feat-m-006');

  const result = migrateTasksLayout();
  assert.strictEqual(result.migrated, 1);
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Personal', 'Cairn', 'feat-m-006.md')));
  assert.ok(fs.existsSync(path.join(TASKS_DIR, 'Personal', 'Atrium', 'feat-m-005.md')));
});
