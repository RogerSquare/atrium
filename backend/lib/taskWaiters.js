// In-process waiter registry for long-polling task status changes.
// See backend/docs/mcp-long-poll-empirical.md + devops-claude-tdd-001.
// TDD-driven; tests live at backend/lib/taskWaiters.test.js.

const waiters = new Map();

function register(filter) {
  return new Promise((resolve) => {
    const id = Symbol('waiter');
    waiters.set(id, { filter, resolve });
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
