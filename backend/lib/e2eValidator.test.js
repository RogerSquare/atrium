// Tests for backend/lib/e2eValidator.js — mirrors branchValidator.test.js shape.

const test = require('node:test');
const assert = require('node:assert');

test('review + no e2e_status → error', () => {
  const { validateE2eStatus } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', tags: [] };
  const result = validateE2eStatus(task, 'todo');
  assert.ok(result, 'should return an error object');
  assert.match(result.error, /e2e_status.*passing/i);
  assert.deepStrictEqual(result.received, { e2e_status: null });
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
  assert.deepStrictEqual(result.received, { e2e_status: 'failing' });
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
