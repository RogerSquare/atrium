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

// Cycle 2: register + notify with a NON-matching task does NOT resolve.
test('register + notify with non-matching task does not resolve', async () => {
  const { register, notify } = requireFresh();
  const waiterPromise = register({ status: 'todo' });
  // Race the waiter against a short sleep. If it resolves within the sleep, test fails.
  const raced = await Promise.race([
    waiterPromise.then(() => 'resolved'),
    (async () => {
      notify({ id: 't-2', status: 'in_progress' }); // not matching
      await new Promise(r => setTimeout(r, 50));
      return 'sleep-won';
    })(),
  ]);
  assert.strictEqual(raced, 'sleep-won', 'waiter should not have resolved for non-matching task');
});

// Helper: re-require the module with a fresh in-memory waiter map.
// Node caches requires, but the module's top-level `new Map()` is fresh per require
// only if we decache. Use delete require.cache.
function requireFresh() {
  const path = require.resolve('./taskWaiters');
  delete require.cache[path];
  return require('./taskWaiters');
}
