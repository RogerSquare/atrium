// Validates that a task transitioning into `review` has a passing test run
// recorded — or carries the `no-e2e` opt-out tag (mirroring the `no-code`
// opt-out in branchValidator.js).
// Pure function; no I/O. See feat-e2e-validation-001 for context;
// suite-aware wording since feat-runners-core-001.

module.exports = { validateE2eStatus };

const VALID_STATES = ['pending', 'passing', 'failing', 'skipped'];

function validateE2eStatus(task, previousStatus) {
  // Grandfather: only fresh transitions INTO review run validation.
  // Existing review/done tasks predate the gate.
  if (previousStatus === 'review' || previousStatus === 'done') return null;
  if (task.status !== 'review') return null;
  // Opt-out for tasks without testable UI surface (backend-only, infra, etc.)
  if (Array.isArray(task.tags) && task.tags.includes('no-e2e')) return null;

  const status = typeof task.e2e_status === 'string' ? task.e2e_status : null;
  if (status === 'passing') return null;

  // Point at the suite that last ran when one is on record — a task tested by
  // "swift-unit" should not be told to run the frontend Playwright suite.
  const suite = typeof task.e2e_suite === 'string' && task.e2e_suite ? task.e2e_suite : null;
  const howToRun = suite
    ? `Re-run suite '${suite}' via the atrium_run_tests MCP tool ({ task: '${task.id}', suite: '${suite}' }) or \`node backend/scripts/run-e2e.js --task ${task.id} --suite ${suite}\``
    : `Run the project's test suite via the atrium_run_tests MCP tool ({ task: '${task.id}' }) — or \`cd frontend && npm run test:e2e\` for the default Playwright suite`;

  return {
    error: `e2e_status must be 'passing' when transitioning task to review.`,
    detail: `${howToRun}, then set e2e_status to 'passing' once green. Valid states: ${VALID_STATES.join(', ')}. To skip this check for a task without testable UI surface (backend-only, infra, refactor), add the 'no-e2e' tag before transitioning.`,
    task_id: task.id,
    received: { e2e_status: task.e2e_status ?? null, e2e_suite: suite },
  };
}
