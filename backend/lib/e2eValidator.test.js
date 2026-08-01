// Tests for backend/lib/e2eValidator.js — mirrors branchValidator.test.js shape.

const test = require('node:test');
const assert = require('node:assert');

test('review + no e2e_status → error', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', tags: [] };
  const result = validateE2eStatus(task, 'todo');
  assert.ok(result, 'should return an error object');
  assert.match(result.error, /e2e_status.*passing/i);
  assert.deepStrictEqual(result.received, { e2e_status: null, e2e_suite: null });
});

test('review + e2e_status=passing → null', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', e2e_status: 'passing', tags: [] };
  assert.strictEqual(validateE2eStatus(task, 'todo'), null);
});

test('review + e2e_status=failing → error', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', e2e_status: 'failing', tags: [] };
  const result = validateE2eStatus(task, 'todo');
  assert.ok(result);
  assert.deepStrictEqual(result.received, { e2e_status: 'failing', e2e_suite: null });
});

// Suite-aware wording (feat-runners-core-001): a task last tested by a named
// suite is pointed back at THAT suite, not at the frontend Playwright run.
test('error detail names the recorded e2e_suite when present', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', e2e_status: 'failing', e2e_suite: 'swift-unit', tags: [] };
  const result = validateE2eStatus(task, 'todo');
  assert.ok(result);
  assert.match(result.detail, /swift-unit/);
  assert.match(result.detail, /atrium_run_tests/);
  assert.strictEqual(result.received.e2e_suite, 'swift-unit');
});

test('error detail falls back to the default suite guidance without e2e_suite', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', tags: [] };
  const result = validateE2eStatus(task, 'todo');
  assert.ok(result);
  assert.match(result.detail, /atrium_run_tests/);
  assert.match(result.detail, /npm run test:e2e/);
});

test('tags includes no-e2e → null (opt-out)', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', tags: ['no-e2e'] };
  assert.strictEqual(validateE2eStatus(task, 'todo'), null);
});

test('previousStatus=review → null (grandfathered)', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', tags: [] };
  assert.strictEqual(validateE2eStatus(task, 'review'), null);
});

test('previousStatus=done → null (grandfathered)', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', tags: [] };
  assert.strictEqual(validateE2eStatus(task, 'done'), null);
});

test('status=in_progress → null (not transitioning to review)', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'in_progress', tags: [] };
  assert.strictEqual(validateE2eStatus(task, 'todo'), null);
});

test('tags undefined → treated as [] (no crash)', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', e2e_status: 'passing' /* tags absent */ };
  assert.strictEqual(validateE2eStatus(task, 'todo'), null);
});

function requireFresh() {
  const p = require.resolve('./e2eValidator');
  delete require.cache[p];
  return require('./e2eValidator');
}
