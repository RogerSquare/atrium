const { logger } = require('./logger');
const github = require('./github');
const loopPty = require('./loopPty');
const loopInstructions = require('./loopInstructions');
const loopActivity = require('./loopActivity');
const { PORT } = require('./constants');

/**
 * Autonomous task executor for worker loops (feat-loopsv2-worker-001).
 *
 * Runs a Claude agent IN THE PROJECT'S REPO (PTY, tools enabled) with a prompt
 * that drives an Atrium task from start to a PR, then STOP at review. NEVER
 * merges (human-only). One executor per loop (concurrency guard). Hardening
 * (outcome verification, cost cap, failure->todo) is feat-loopsv2-executor-001.
 *
 * SAFETY: only runs when a loop is explicitly mode='worker' AND enabled — both
 * off by default. cwd is scoped to the single project repo, never the whole
 * working directory.
 */

const activeExecutors = new Map(); // loopId -> { taskId, runId }

function isExecuting(loopId) {
  return activeExecutors.has(loopId);
}

// Pure (exported for tests): the execution prompt given to the agent.
function buildExecutionPrompt(loop, task, instructions, repoPath) {
  const branch = `loop/${task.id}`;
  return [
    `You are an autonomous developer agent working a task on the Atrium board.`,
    `Repository: ${repoPath} (current working directory). Backend API: http://localhost:${PORT}`,
    '',
    `## Task ${task.id}: ${task.title}`,
    `Status: ${task.status} | Priority: ${task.priority || 'medium'} | Type: ${task.type || 'fullstack'}`,
    '',
    '### Task description',
    (task.content || '(no description)').slice(0, 4000),
    '',
    '### Loop policy / instructions',
    instructions,
    '',
    '### STRICT workflow (follow exactly)',
    '1. `git checkout main && git pull origin main` then create a branch whose name contains the task id, e.g. `git checkout -b ' + branch + '`.',
    '2. Implement the change on that branch. Keep scope to the task.',
    '3. Run the project tests / lint / build and make them pass before proceeding.',
    '4. Commit with a conventional message including a `Task: ' + task.id + '` trailer, then `git push -u origin ' + branch + '`.',
    '5. Open a PR: `gh pr create --base main --head ' + branch + '` with a summary + test plan referencing the task id.',
    '6. Set the task to review via the API (do NOT mark it done): ',
    '   `curl -X PUT http://localhost:' + PORT + '/api/tasks/' + task.id + ' -H "Content-Type: application/json" -d \'{"status":"review","github_pr_url":"<the PR url>","files_affected":["..."]}\'` (use your agent token if required).',
    '',
    '### HARD RULES',
    '- NEVER merge the PR. NEVER push to `main`. NEVER `--force` push to `main`.',
    '- Stop after the task is in `review`. A human reviews and merges.',
    '- If you cannot complete it, set the task back to `todo` with a comment explaining why, and stop.',
  ].join('\n');
}

// Fire-and-forget: start an executor run for a claimed task. Returns the runId
// (or null if it could not start). Caller guards on isExecuting().
function run(loop, task) {
  const repoPath = github.resolveProjectRepoPath(loop.project);
  if (!repoPath) {
    loopActivity.append(loop.id, { type: 'error', message: `Executor: no git repo for project ${loop.project}; cannot run ${task.id}`, refs: { task_id: task.id } });
    return null;
  }
  const instructions = loopInstructions.resolve(loop);
  const prompt = buildExecutionPrompt(loop, task, instructions, repoPath);

  const runId = loopPty.start(loop, {
    prompt,
    label: `execute ${task.id}`,
    cwd: repoPath,
    allowTools: true,
    onExit: ({ code, status }) => {
      activeExecutors.delete(loop.id);
      loopActivity.append(loop.id, { type: 'executor', message: `Executor for ${task.id} finished (${status}, exit ${code})`, refs: { task_id: task.id, run_id: runId } });
    },
  });
  activeExecutors.set(loop.id, { taskId: task.id, runId });
  loopActivity.append(loop.id, { type: 'executor', message: `Executor started for ${task.id} in ${repoPath}`, refs: { task_id: task.id, run_id: runId } });
  logger.info({ loopId: loop.id, taskId: task.id, runId }, 'loop executor started');
  return runId;
}

module.exports = { run, isExecuting, buildExecutionPrompt };
