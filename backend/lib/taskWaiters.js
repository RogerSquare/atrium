// In-process waiter registry for long-polling task status changes.
// See backend/docs/mcp-long-poll-empirical.md + devops-claude-tdd-001.
// TDD-driven; tests live at backend/lib/taskWaiters.test.js.

const waiters = new Map();

function register() {
  return new Promise((resolve) => {
    const id = Symbol('waiter');
    waiters.set(id, { resolve });
  });
}

function notify(task) {
  for (const [id, { resolve }] of waiters) {
    waiters.delete(id);
    resolve(task);
    return id;
  }
  return null;
}

module.exports = { register, notify };
