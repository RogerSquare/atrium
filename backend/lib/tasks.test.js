// Tests for the updateTaskField helper added in feat-shell-task-resume-002.
// Uses a sentinel id (not in any active project) and the real TASKS_DIR so
// the index/cache integration is exercised — the fixture file is created in
// a try/finally to make sure cleanup happens even if an assertion fails.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { TASKS_DIR } = require('./constants');

const FIXTURE_ID = '_test_session_mint_a39c18';
const FIXTURE_PATH = path.join(TASKS_DIR, `${FIXTURE_ID}.md`);

function writeFixture(extraData = {}) {
  const data = {
    id: FIXTURE_ID,
    title: 'fixture for updateTaskField',
    status: 'todo',
    activity_log: [],
    ...extraData,
  };
  const body = '\n### Description\n\nfixture\n\n### Comments\n';
  fs.writeFileSync(FIXTURE_PATH, matter.stringify(body, data));
}

function cleanup() {
  try { if (fs.existsSync(FIXTURE_PATH)) fs.unlinkSync(FIXTURE_PATH); } catch { /* swallow */ }
}

function requireFresh() {
  const p = require.resolve('./tasks');
  delete require.cache[p];
  return require('./tasks');
}

test('updateTaskField mints claude_session_id and writes activity_log entry', async () => {
  cleanup();
  writeFixture();
  try {
    const { buildIndex, updateTaskField } = requireFresh();
    buildIndex();

    const result = await updateTaskField(
      FIXTURE_ID,
      'claude_session_id',
      'aaaa1111-bbbb-2222-cccc-333344445555',
      'web-shell',
      'Session id minted for shell binding'
    );
    assert.strictEqual(result.claude_session_id, 'aaaa1111-bbbb-2222-cccc-333344445555');

    const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    const parsed = matter(raw);
    assert.strictEqual(parsed.data.claude_session_id, 'aaaa1111-bbbb-2222-cccc-333344445555');
    assert.ok(Array.isArray(parsed.data.activity_log));
    const last = parsed.data.activity_log[parsed.data.activity_log.length - 1];
    assert.match(last.action, /Session id minted for shell binding by web-shell/);
  } finally {
    cleanup();
  }
});

test('updateTaskField on a second call rotates the field and appends a second log entry', async () => {
  cleanup();
  writeFixture({ claude_session_id: 'old-uuid-0000-0000-0000-000000000000' });
  try {
    const { buildIndex, updateTaskField } = requireFresh();
    buildIndex();

    await updateTaskField(
      FIXTURE_ID,
      'claude_session_id',
      'fresh-uuid-1111-1111-1111-111111111111',
      'web-shell',
      'Session id rotated for shell binding'
    );

    const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    const parsed = matter(raw);
    assert.strictEqual(parsed.data.claude_session_id, 'fresh-uuid-1111-1111-1111-111111111111');
    const log = parsed.data.activity_log || [];
    const rotateEntries = log.filter((e) => /rotated/.test(e.action));
    assert.strictEqual(rotateEntries.length, 1);
  } finally {
    cleanup();
  }
});

test('updateTaskField throws for missing task id', async () => {
  const { updateTaskField } = requireFresh();
  await assert.rejects(
    () => updateTaskField('_does_not_exist_xyz_001', 'claude_session_id', 'whatever', 'web-shell', null),
    /Task not found/
  );
});

test('getAllTasks surfaces claude_session_id on tasks that have it', () => {
  cleanup();
  writeFixture({ claude_session_id: 'surfaced-2222-2222-2222-222222222222' });
  try {
    const { getAllTasks, invalidateCache } = requireFresh();
    invalidateCache();
    const all = getAllTasks();
    const fixture = all.find((t) => t.id === FIXTURE_ID);
    assert.ok(fixture, 'fixture not picked up by scanAllTasks');
    assert.strictEqual(fixture.claude_session_id, 'surfaced-2222-2222-2222-222222222222');
  } finally {
    cleanup();
  }
});

