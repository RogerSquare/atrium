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

// Cycle 4: abort signal fires → waiter rejects with 'aborted' and is removed.
test('register + abort signal fires → rejects with aborted; waiter removed', async () => {
  const { register, notify } = requireFresh();
  const controller = new AbortController();
  const waiterPromise = register({ status: 'todo' }, controller.signal);
  // Fire abort on next tick.
  setImmediate(() => controller.abort());
  let rejected = false;
  try {
    await waiterPromise;
  } catch (err) {
    rejected = true;
    assert.strictEqual(err.message, 'aborted');
  }
  assert.ok(rejected, 'waiter should reject on abort');
  // Confirm waiter is gone — a subsequent notify should return null (no waiters).
  const notifyResult = notify({ id: 't-5', status: 'todo' });
  assert.strictEqual(notifyResult, null, 'aborted waiter must be removed from map');
});

// Cycle 5: notify with no waiters registered → returns null, does not throw.
test('notify with no waiters returns null, no throw', () => {
  const { notify } = requireFresh();
  const result = notify({ id: 't-6', status: 'todo' });
  assert.strictEqual(result, null);
});

// Cycle 6: filter.assignee matching is flexible — unassigned task matches any assignee filter.
test('filter.assignee matches exact OR unassigned task', async () => {
  const { register, notify } = requireFresh();

  // Exact match
  const waiterExact = register({ status: 'todo', assignee: 'agent:bob' });
  setImmediate(() => notify({ id: 't-bob', status: 'todo', assignee: 'agent:bob' }));
  const exactTask = await waiterExact;
  assert.strictEqual(exactTask.id, 't-bob');

  // Unassigned task matches any assignee filter
  const waiterLoose = register({ status: 'todo', assignee: 'agent:alice' });
  setImmediate(() => notify({ id: 't-unassigned', status: 'todo' })); // no assignee
  const looseTask = await waiterLoose;
  assert.strictEqual(looseTask.id, 't-unassigned');

  // A task assigned to a DIFFERENT agent should NOT match
  const waiterNoMatch = register({ status: 'todo', assignee: 'agent:alice' });
  const raced = await Promise.race([
    waiterNoMatch.then(() => 'resolved'),
    (async () => {
      notify({ id: 't-bob2', status: 'todo', assignee: 'agent:bob' });
      await new Promise(r => setTimeout(r, 30));
      return 'sleep-won';
    })(),
  ]);
  assert.strictEqual(raced, 'sleep-won', 'mismatched assignee must not resolve');
});

// Helper: re-require the module with a fresh in-memory waiter map.
// Node caches requires, but the module's top-level `new Map()` is fresh per require
// only if we decache. Use delete require.cache.
function requireFresh() {
  const path = require.resolve('./taskWaiters');
  delete require.cache[path];
  return require('./taskWaiters');
}
