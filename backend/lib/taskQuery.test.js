// Unit tests for backend/lib/taskQuery.js (opt-tasks-pagination-001).

const test = require('node:test');
const assert = require('node:assert');

const { filterTasks, paginateTasks, MAX_LIMIT } = require('./taskQuery');

const T = (id, status, assignee) => ({ id, status, assignee });
const TASKS = [
  T('a-001', 'todo', null),
  T('a-002', 'todo', 'agent:claude'),
  T('a-003', 'in_progress', 'agent:claude'),
  T('a-004', 'review', 'roger'),
  T('a-005', 'todo', 'roger'),
];

// --- filterTasks ---------------------------------------------------------

test('no filters is a passthrough', () => {
  assert.strictEqual(filterTasks(TASKS, {}), TASKS);
  assert.strictEqual(filterTasks(TASKS), TASKS);
});

test('status and assignee filter exactly and compose', () => {
  assert.deepStrictEqual(filterTasks(TASKS, { status: 'todo' }).map(t => t.id), ['a-001', 'a-002', 'a-005']);
  assert.deepStrictEqual(filterTasks(TASKS, { assignee: 'roger' }).map(t => t.id), ['a-004', 'a-005']);
  assert.deepStrictEqual(filterTasks(TASKS, { status: 'todo', assignee: 'roger' }).map(t => t.id), ['a-005']);
});

test('empty-string filters are skipped like absent ones', () => {
  assert.strictEqual(filterTasks(TASKS, { status: '', assignee: '' }).length, TASKS.length);
});

// --- paginateTasks -------------------------------------------------------

test('BACK-COMPAT: no limit → unpaged verdict with the untouched array', () => {
  for (const q of [{}, { offset: 3 }, { limit: '' }, { limit: undefined }]) {
    const r = paginateTasks(TASKS, q);
    assert.strictEqual(r.paged, false, `${JSON.stringify(q)} must stay unpaged`);
    assert.strictEqual(r.tasks, TASKS);
  }
});

test('limit pages and total counts the FILTERED set, not the page', () => {
  const r = paginateTasks(TASKS, { limit: '2', offset: '2' });
  assert.strictEqual(r.paged, true);
  assert.strictEqual(r.total, 5);
  assert.deepStrictEqual(r.tasks.map(t => t.id), ['a-003', 'a-004']);
  assert.strictEqual(r.limit, 2);
  assert.strictEqual(r.offset, 2);
});

test('limit is capped, garbage falls back sanely', () => {
  assert.strictEqual(paginateTasks(TASKS, { limit: '99999' }).limit, MAX_LIMIT);
  const junk = paginateTasks(TASKS, { limit: 'abc', offset: '-5' });
  assert.strictEqual(junk.paged, true);
  assert.strictEqual(junk.offset, 0, 'negative offset clamps to 0');
  assert.ok(junk.limit > 0);
});

test('offset past the end yields an empty page but a truthful total', () => {
  const r = paginateTasks(TASKS, { limit: '10', offset: '50' });
  assert.deepStrictEqual(r.tasks, []);
  assert.strictEqual(r.total, 5);
});

test('filter-then-page composition: total reflects the filter', () => {
  const filtered = filterTasks(TASKS, { status: 'todo' });
  const r = paginateTasks(filtered, { limit: '2' });
  assert.strictEqual(r.total, 3);
  assert.deepStrictEqual(r.tasks.map(t => t.id), ['a-001', 'a-002']);
});
