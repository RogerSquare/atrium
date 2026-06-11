// Unit tests for backend/routes/autoenterHook.js (feat-autoenter-hook-signal-001).
// Pure tests — the task loader and env are injected, so nothing here touches
// the real tasks directory, environment, or socket.io.

const test = require('node:test');
const assert = require('node:assert');
const { resolveTaskId, tokenOk } = require('./autoenterHook');

// --- resolveTaskId -------------------------------------------------------

test('header task id wins over everything and is trimmed', () => {
  const loadTasks = () => { throw new Error('loadTasks should not be called when header present'); };
  assert.strictEqual(
    resolveTaskId({ headerTaskId: '  feat-x-001  ', sessionId: 'abc', loadTasks }),
    'feat-x-001',
  );
});

test('falls back to session_id -> claude_session_id task match', () => {
  const loadTasks = () => [
    { id: 'feat-a-001', claude_session_id: 'uuid-aaa' },
    { id: 'feat-b-002', claude_session_id: 'uuid-bbb' },
  ];
  assert.strictEqual(
    resolveTaskId({ headerTaskId: '', sessionId: 'uuid-bbb', loadTasks }),
    'feat-b-002',
  );
});

test('returns null when neither header nor a matching session is found', () => {
  const loadTasks = () => [{ id: 'feat-a-001', claude_session_id: 'uuid-aaa' }];
  assert.strictEqual(
    resolveTaskId({ headerTaskId: '', sessionId: 'uuid-none', loadTasks }),
    null,
  );
});

test('returns null when both header and session are empty/whitespace', () => {
  const loadTasks = () => { throw new Error('loadTasks should not be called for empty session'); };
  assert.strictEqual(resolveTaskId({ headerTaskId: '   ', sessionId: '   ', loadTasks }), null);
});

test('a throwing task loader is swallowed and yields null (never crashes the hook)', () => {
  const loadTasks = () => { throw new Error('disk on fire'); };
  assert.strictEqual(resolveTaskId({ headerTaskId: '', sessionId: 'uuid-x', loadTasks }), null);
});

// --- tokenOk -------------------------------------------------------------

function fakeReq(headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { get: (name) => lower[name.toLowerCase()] };
}

test('tokenOk allows everything when no secret is configured (dev mode)', () => {
  assert.strictEqual(tokenOk(fakeReq(), {}), true);
});

test('tokenOk accepts a matching Bearer token', () => {
  const env = { ATRIUM_HOOK_TOKEN: 's3cret' };
  assert.strictEqual(tokenOk(fakeReq({ Authorization: 'Bearer s3cret' }), env), true);
});

test('tokenOk accepts a matching X-Atrium-Hook-Token header', () => {
  const env = { ATRIUM_HOOK_TOKEN: 's3cret' };
  assert.strictEqual(tokenOk(fakeReq({ 'X-Atrium-Hook-Token': 's3cret' }), env), true);
});

test('tokenOk rejects a wrong or missing token when a secret is configured', () => {
  const env = { ATRIUM_HOOK_TOKEN: 's3cret' };
  assert.strictEqual(tokenOk(fakeReq({ Authorization: 'Bearer nope' }), env), false);
  assert.strictEqual(tokenOk(fakeReq({}), env), false);
});
