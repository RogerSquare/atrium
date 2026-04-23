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

// Cycle 3: two registrations + one matching notify — only first waiter resolves.
test('two registrations, one notify — first-call-wins; second remains parked', async () => {
  const { register, notify } = requireFresh();
  const waiterA = register({ status: 'todo' });
  const waiterB = register({ status: 'todo' });
  const result = await Promise.race([
    waiterA.then((t) => ({ who: 'A', task: t })),
    waiterB.then((t) => ({ who: 'B', task: t })),
    (async () => {
      setImmediate(() => notify({ id: 't-3', status: 'todo' }));
      await new Promise(r => setTimeout(r, 30));
      return null;
    })(),
  ]);
  assert.strictEqual(result.who, 'A', 'first-registered waiter should win');
  assert.strictEqual(result.task.id, 't-3');
  // waiterB should still be pending — send another notify to confirm
  const secondResult = await Promise.race([
    waiterB.then((t) => ({ who: 'B-second', task: t })),
    (async () => {
      setImmediate(() => notify({ id: 't-4', status: 'todo' }));
      await new Promise(r => setTimeout(r, 30));
      return null;
    })(),
  ]);
  assert.strictEqual(secondResult.who, 'B-second');
  assert.strictEqual(secondResult.task.id, 't-4');
});

// Helper: re-require the module with a fresh in-memory waiter map.
// Node caches requires, but the module's top-level `new Map()` is fresh per require
// only if we decache. Use delete require.cache.
function requireFresh() {
  const path = require.resolve('./taskWaiters');
  delete require.cache[path];
  return require('./taskWaiters');
}
