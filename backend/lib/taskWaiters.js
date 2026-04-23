// In-process waiter registry for long-polling task status changes.
// See backend/docs/mcp-long-poll-empirical.md + devops-claude-tdd-001.
// TDD-driven; tests live at backend/lib/taskWaiters.test.js.

const waiters = new Map();

/**
 * Register a waiter. Returns a promise that resolves with the first task
 * matching `filter`, or rejects with Error('aborted') if `signal` fires.
 *
 * @param {{ status?: string, assignee?: string, project?: string }} filter
 * @param {AbortSignal} [signal]  Optional abort signal for timeout / disconnect.
 */
function register(filter, signal) {
  return new Promise((resolve, reject) => {
    const id = Symbol('waiter');
    const entry = { filter, resolve, reject, signal };
    waiters.set(id, entry);
    if (signal) {
      const onAbort = () => {
        waiters.delete(id);
        reject(new Error('aborted'));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function matches(task, filter) {
  if (filter.status && task.status !== filter.status) return false;
  return true;
}

function notify(task) {
  for (const [id, { filter, resolve }] of waiters) {
    if (!matches(task, filter)) continue;
    waiters.delete(id);
    resolve(task);
    return id;
  }
  return null;
}

module.exports = { register, notify };
