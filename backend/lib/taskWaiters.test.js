// TDD tests for backend/lib/taskWaiters.js
// Written cycle-by-cycle (see git log on feat/todo-watcher branch).
// Tagged `tdd` per devops-claude-tdd-001.

const test = require('node:test');
const assert = require('node:assert');

// Cycle 1: register + notify with a matching task resolves with that task.
test('register + notify with matching task resolves', async () => {
  const { register, notify } = requireFresh();
  const waiterPromise = register({ status: 'todo' });
  // Fire notify on next tick so register's waiter is in the map.
  setImmediate(() => notify({ id: 't-1', status: 'todo' }));
  const task = await waiterPromise;
  assert.strictEqual(task.id, 't-1');
});

// Helper: re-require the module with a fresh in-memory waiter map.
// Node caches requires, but the module's top-level `new Map()` is fresh per require
// only if we decache. Use delete require.cache.
function requireFresh() {
  const path = require.resolve('./taskWaiters');
  delete require.cache[path];
  return require('./taskWaiters');
}
