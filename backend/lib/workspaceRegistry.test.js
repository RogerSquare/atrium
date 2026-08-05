// Workspace registry + projectRegistry workspace integration
// (feat-workspaces-impl-001).
//
// node --test runs each test FILE in its own process, so pointing
// ATRIUM_DATA_DIR at a temp dir BEFORE requiring the modules exercises the
// real constants → dataDir → registry path with zero risk to real state.

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-ws-test-'));
process.env.ATRIUM_DATA_DIR = TMP;

const test = require('node:test');
const assert = require('node:assert');

const workspaces = require('./workspaceRegistry');
const projects = require('./projectRegistry');
const { WORKSPACES_FILE, PROJECTS_FILE } = require('./constants');

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

// Tests share one registry file and run sequentially (node:test default);
// each test resets both files to keep them independent.
const reset = (workspacesJson, projectsJson) => {
  if (workspacesJson === undefined) fs.rmSync(WORKSPACES_FILE, { force: true });
  else fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspacesJson), 'utf8');
  if (projectsJson === undefined) fs.rmSync(PROJECTS_FILE, { force: true });
  else fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projectsJson), 'utf8');
};

test('ensureDefault creates Personal on a fresh install and is idempotent', () => {
  reset();
  workspaces.ensureDefault();
  const first = JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf8'));
  assert.deepStrictEqual(first.personal, { name: 'Personal', order: 0 });
  // Renames survive a re-run — ensureDefault only fills the gap.
  workspaces.rename('personal', 'Mine');
  workspaces.ensureDefault();
  assert.strictEqual(workspaces.getById('personal').name, 'Mine');
});

test('getAll sorts by order then name and always includes the default', () => {
  reset({
    zeta: { name: 'Zeta', order: 2 },
    personal: { name: 'Personal', order: 0 },
    alpha: { name: 'Alpha', order: 2 },
  });
  assert.deepStrictEqual(workspaces.getAll().map(w => w.id), ['personal', 'alpha', 'zeta']);
  reset();
  assert.deepStrictEqual(workspaces.getAll().map(w => w.id), ['personal']);
});

test('create slugs the id, rejects empty and duplicate names (case-insensitive)', () => {
  reset();
  const ws = workspaces.create('Open Source Forks');
  assert.strictEqual(ws.id, 'osf');
  assert.strictEqual(ws.name, 'Open Source Forks');
  assert.strictEqual(ws.order, 1);
  assert.strictEqual(workspaces.create('open source forks'), null);
  assert.strictEqual(workspaces.create('   '), null);
  // Id collision gets a numeric suffix, not a clobber.
  const ws2 = workspaces.create('Ordinary Shell Fun');
  assert.strictEqual(ws2.id, 'osf1');
});

test('rename guards duplicates, setColor clears on null, setOrder rejects non-numbers', () => {
  reset({ personal: { name: 'Personal', order: 0 }, work: { name: 'Work', order: 1 } });
  assert.strictEqual(workspaces.rename('work', 'Personal'), false);
  assert.strictEqual(workspaces.rename('work', 'Client Work'), true);
  assert.strictEqual(workspaces.setColor('work', '#ff8800'), true);
  assert.strictEqual(workspaces.getById('work').color, '#ff8800');
  workspaces.setColor('work', null);
  assert.strictEqual(workspaces.getById('work').color, undefined);
  assert.strictEqual(workspaces.setOrder('work', 'first'), false);
  assert.strictEqual(workspaces.setOrder('work', 5), true);
});

test('remove: default is undeletable, in-use is blocked with a count, empty deletes', () => {
  reset(
    { personal: { name: 'Personal', order: 0 }, work: { name: 'Work', order: 1 }, empty: { name: 'Empty', order: 2 } },
    { atb: { name: 'Atrium', folder: 'Atrium', workspace: 'work' }, cairn: { name: 'Cairn', folder: 'Cairn', workspace: 'work' } },
  );
  assert.deepStrictEqual(workspaces.remove('personal'), { ok: false, reason: 'default' });
  assert.deepStrictEqual(workspaces.remove('missing'), { ok: false, reason: 'not_found' });
  assert.deepStrictEqual(workspaces.remove('work'), { ok: false, reason: 'in_use', count: 2 });
  assert.deepStrictEqual(workspaces.remove('empty'), { ok: true });
  assert.strictEqual(workspaces.getById('empty'), null);
});

test('migrateWorkspaces stamps legacy entries once and leaves assigned ones alone', () => {
  reset(undefined, {
    old: { name: 'Legacy', folder: 'Legacy' },
    assigned: { name: 'Assigned', folder: 'Assigned', workspace: 'work' },
  });
  assert.strictEqual(projects.migrateWorkspaces(), true);
  const after = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  assert.strictEqual(after.old.workspace, 'personal');
  assert.strictEqual(after.assigned.workspace, 'work');
  // Second run: nothing left to change.
  assert.strictEqual(projects.migrateWorkspaces(), false);
});

test('getAll synthesizes root pinned to the default workspace and defaults hand-edited entries', () => {
  reset(undefined, { bare: { name: 'Bare', folder: 'Bare' } });
  const all = projects.getAll({ include: 'active' });
  assert.strictEqual(all.root.workspace, 'personal');
  assert.strictEqual(all.bare.workspace, 'personal');
});

test('register and syncWithDisk stamp new entries into a workspace', () => {
  reset(undefined, {});
  const reg = projects.register('Fresh', null, 'work');
  assert.strictEqual(reg.workspace, 'work');
  const dflt = projects.register('Defaulted');
  assert.strictEqual(dflt.workspace, 'personal');
  projects.syncWithDisk(['Fresh', 'Defaulted', 'Discovered']);
  const disk = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
  const discovered = Object.values(disk).find(p => p.folder === 'Discovered');
  assert.strictEqual(discovered.workspace, 'personal');
});

test('setWorkspace moves a project, refuses root and unknown ids', () => {
  reset(undefined, { atb: { name: 'Atrium', folder: 'Atrium', workspace: 'personal' } });
  assert.strictEqual(projects.setWorkspace('atb', 'work'), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')).atb.workspace, 'work');
  assert.strictEqual(projects.setWorkspace('root', 'work'), false);
  assert.strictEqual(projects.setWorkspace('missing', 'work'), false);
  assert.strictEqual(projects.setWorkspace('atb', ''), false);
});
