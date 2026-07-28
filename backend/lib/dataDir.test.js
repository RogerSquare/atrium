// Unit tests for backend/lib/dataDir.js (devops-docker-datadir-001).
// Pure tests — env and the default root are injected, so nothing here reads
// the real environment or touches the filesystem except the explicitly
// temp-dir-scoped ensureDataDirs cases at the bottom.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { resolveDataDir, buildDataPaths, ensureDataDirs } = require('./dataDir');

const BACKEND = '/srv/atrium/backend';

// --- resolveDataDir ------------------------------------------------------

test('defaults to the backend root when ATRIUM_DATA_DIR is unset', () => {
  assert.strictEqual(resolveDataDir({ env: {}, defaultRoot: BACKEND }), BACKEND);
});

test('ATRIUM_DATA_DIR overrides the default root', () => {
  const r = resolveDataDir({ env: { ATRIUM_DATA_DIR: '/data' }, defaultRoot: BACKEND });
  assert.strictEqual(r, path.resolve('/data'));
});

test('a blank or whitespace-only ATRIUM_DATA_DIR falls back to the default', () => {
  assert.strictEqual(resolveDataDir({ env: { ATRIUM_DATA_DIR: '' }, defaultRoot: BACKEND }), BACKEND);
  assert.strictEqual(resolveDataDir({ env: { ATRIUM_DATA_DIR: '   ' }, defaultRoot: BACKEND }), BACKEND);
});

// --- buildDataPaths ------------------------------------------------------

test('every state path hangs off the given root', () => {
  const p = buildDataPaths(BACKEND, {});

  assert.strictEqual(p.TASKS_DIR, path.join(BACKEND, 'tasks'));
  assert.strictEqual(p.USERS_DIR, path.join(BACKEND, 'users'));
  assert.strictEqual(p.APPROVALS_DIR, path.join(BACKEND, 'approvals'));
  assert.strictEqual(p.AGENT_TOKENS_DIR, path.join(BACKEND, 'agent-tokens'));
  assert.strictEqual(p.CHAT_DIR, path.join(BACKEND, 'chat'));
  assert.strictEqual(p.SETTINGS_FILE, path.join(BACKEND, 'settings.json'));
  assert.strictEqual(p.SERVICES_FILE, path.join(BACKEND, 'services.json'));
  assert.strictEqual(p.PROJECTS_FILE, path.join(BACKEND, 'projects.json'));
  assert.strictEqual(p.LOOPS_FILE, path.join(BACKEND, 'loops.json'));
  assert.strictEqual(p.LOOP_RUNS_DIR, path.join(BACKEND, 'loop-runs'));
  assert.strictEqual(p.LOOP_TEMPLATES_FILE, path.join(BACKEND, 'loop-templates.json'));
  assert.strictEqual(p.E2E_RUNS_DIR, path.join(BACKEND, 'e2e-runs'));
  assert.strictEqual(p.AUTOENTER_DIR, path.join(BACKEND, 'autoenter'));
  assert.strictEqual(p.UPLOADS_DIR, path.join(BACKEND, 'uploads', 'design'));
  assert.strictEqual(p.JWT_SECRET_FILE, path.join(BACKEND, '.jwt-secret'));
});

test('nested paths are derived from their parent, not re-rooted independently', () => {
  const p = buildDataPaths(BACKEND, {});

  assert.strictEqual(p.HISTORY_DIR, path.join(p.TASKS_DIR, '.history'));
  assert.strictEqual(p.TRASH_DIR, path.join(p.TASKS_DIR, '.trash'));
  assert.strictEqual(p.ARCHIVED_DIR, path.join(p.TASKS_DIR, '.archived'));
  assert.strictEqual(p.CHAT_FILE, path.join(p.CHAT_DIR, 'chat-messages.json'));
  assert.strictEqual(p.AGENT_TOKENS_BLOCKLIST, path.join(p.AGENT_TOKENS_DIR, '.blocklist.json'));
  assert.strictEqual(p.AUTOENTER_CAPTURES_FILE, path.join(p.AUTOENTER_DIR, 'captures.json'));
  assert.strictEqual(p.PROTOTYPES_DIR, path.join(p.UPLOADS_DIR, 'prototypes'));
});

// --- per-file env overrides ----------------------------------------------
// These predate ATRIUM_DATA_DIR (the loop tests point them at throwaway files
// so a test run never clobbers real loops). They MUST keep winning over the
// new root, otherwise this refactor silently breaks the loop test scripts.

test('pre-existing per-file env overrides win over the data root', () => {
  const p = buildDataPaths(BACKEND, {
    ATRIUM_LOOPS_FILE: '/tmp/loops.json',
    ATRIUM_LOOP_RUNS_DIR: '/tmp/loop-runs',
    ATRIUM_LOOP_TEMPLATES_FILE: '/tmp/loop-templates.json',
  });

  assert.strictEqual(p.LOOPS_FILE, '/tmp/loops.json');
  assert.strictEqual(p.LOOP_RUNS_DIR, '/tmp/loop-runs');
  assert.strictEqual(p.LOOP_TEMPLATES_FILE, '/tmp/loop-templates.json');
});

test('unset per-file overrides leave the rooted defaults intact', () => {
  const p = buildDataPaths(BACKEND, { ATRIUM_LOOPS_FILE: '/tmp/loops.json' });

  assert.strictEqual(p.LOOPS_FILE, '/tmp/loops.json');
  assert.strictEqual(p.LOOP_RUNS_DIR, path.join(BACKEND, 'loop-runs'));
  assert.strictEqual(p.LOOP_TEMPLATES_FILE, path.join(BACKEND, 'loop-templates.json'));
});

// --- ensureDataDirs ------------------------------------------------------
// A fresh container volume is an empty directory. Every state dir has to be
// created up front or the first write to it throws ENOENT.

test('creates every state directory under an empty root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-datadir-'));
  try {
    const p = buildDataPaths(root, {});
    ensureDataDirs(p);

    for (const dir of [
      p.TASKS_DIR, p.HISTORY_DIR, p.TRASH_DIR, p.ARCHIVED_DIR,
      p.APPROVALS_DIR, p.AGENT_TOKENS_DIR, p.USERS_DIR, p.CHAT_DIR,
      p.LOOP_RUNS_DIR, p.E2E_RUNS_DIR, p.AUTOENTER_DIR,
      p.UPLOADS_DIR, p.PROTOTYPES_DIR,
    ]) {
      assert.ok(fs.existsSync(dir), `expected ${path.relative(root, dir)} to exist`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('is idempotent and preserves existing content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-datadir-'));
  try {
    const p = buildDataPaths(root, {});
    ensureDataDirs(p);

    const marker = path.join(p.TASKS_DIR, 'keep-me.md');
    fs.writeFileSync(marker, 'do not clobber');

    ensureDataDirs(p);

    assert.strictEqual(fs.readFileSync(marker, 'utf-8'), 'do not clobber');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('honors a per-file override that points outside the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-datadir-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-elsewhere-'));
  try {
    const runs = path.join(elsewhere, 'loop-runs');
    const p = buildDataPaths(root, { ATRIUM_LOOP_RUNS_DIR: runs });
    ensureDataDirs(p);

    assert.ok(fs.existsSync(runs), 'overridden loop-runs dir should be created at its real location');
    assert.ok(!fs.existsSync(path.join(root, 'loop-runs')), 'should not also create it under the root');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});
