const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Redirect the captures file to a throwaway temp dir BEFORE the module
// under test resolves its constants. constants.js reads paths at require
// time, so we stub fs paths via a fresh temp dir and point the module's
// AUTOENTER_CAPTURES_FILE at it by overriding the constant after load.
const {
  normalizeCapture,
  appendCapture,
  queryCaptures,
  clearCaptures,
  loadCaptures,
} = require('./autoEnterCaptures');

const captures = require('./autoEnterCaptures');
const { AUTOENTER_CAPTURES_FILE } = require('./constants');

// Work against the real configured path but in a clean state each test —
// the file lives under backend/autoenter/ which is gitignored runtime data.
function reset() {
  try {
    fs.rmSync(path.dirname(AUTOENTER_CAPTURES_FILE), { recursive: true, force: true });
  } catch {
    /* nothing to clean */
  }
}

test('normalizeCapture rejects empty/whitespace bufferTail', () => {
  assert.equal(normalizeCapture({ bufferTail: '' }), null);
  assert.equal(normalizeCapture({ bufferTail: '   ' }), null);
  assert.equal(normalizeCapture({}), null);
  assert.equal(normalizeCapture(null), null);
});

test('normalizeCapture fills defaults and clamps fields', () => {
  const entry = normalizeCapture(
    { bufferTail: 'Do you want to proceed?', taskId: 'feat-x-001' },
    { now: 1000, user: 'roger' },
  );
  assert.equal(entry.bufferTail, 'Do you want to proceed?');
  assert.equal(entry.taskId, 'feat-x-001');
  assert.equal(entry.classification, 'unknown'); // default
  assert.equal(entry.capturedAt, 1000); // falls back to `now`
  assert.equal(entry.loggedAt, 1000);
  assert.equal(entry.user, 'roger');
});

test('normalizeCapture truncates an oversized tail', () => {
  const huge = 'x'.repeat(10000);
  const entry = normalizeCapture({ bufferTail: huge });
  assert.equal(entry.bufferTail.length, captures.MAX_TAIL_LEN);
});

test('appendCapture persists and round-trips', async () => {
  reset();
  const r1 = await appendCapture({ bufferTail: 'prompt one', taskId: 't1' });
  assert.equal(r1.total, 1);
  const r2 = await appendCapture({ bufferTail: 'prompt two', taskId: 't2' });
  assert.equal(r2.total, 2);
  const onDisk = loadCaptures();
  assert.equal(onDisk.length, 2);
  assert.equal(onDisk[0].bufferTail, 'prompt one');
  reset();
});

test('appendCapture returns null on unusable input (no write)', async () => {
  reset();
  const r = await appendCapture({ bufferTail: '   ' });
  assert.equal(r, null);
  assert.equal(loadCaptures().length, 0);
  reset();
});

test('queryCaptures filters by taskId and returns newest-first', async () => {
  reset();
  await appendCapture({ bufferTail: 'a', taskId: 't1', capturedAt: 100 });
  await appendCapture({ bufferTail: 'b', taskId: 't2', capturedAt: 200 });
  await appendCapture({ bufferTail: 'c', taskId: 't1', capturedAt: 300 });

  const all = queryCaptures({});
  assert.equal(all.total, 3);
  assert.equal(all.captures[0].bufferTail, 'c'); // newest first

  const t1 = queryCaptures({ taskId: 't1' });
  assert.equal(t1.total, 2);
  assert.deepEqual(t1.captures.map((c) => c.bufferTail), ['c', 'a']);
  reset();
});

test('queryCaptures honors limit', async () => {
  reset();
  for (let i = 0; i < 5; i += 1) {
    await appendCapture({ bufferTail: `p${i}`, capturedAt: i });
  }
  const limited = queryCaptures({ limit: 2 });
  assert.equal(limited.captures.length, 2);
  assert.equal(limited.total, 5); // total reflects full set, not the page
  reset();
});

test('clearCaptures empties the log', async () => {
  reset();
  await appendCapture({ bufferTail: 'something' });
  assert.equal(loadCaptures().length, 1);
  await clearCaptures();
  assert.equal(loadCaptures().length, 0);
  reset();
});
