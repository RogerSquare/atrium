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
// Template-driven (feat-loopsv2-prompttemplate-001): render the loop's custom
// `prompt_template` (or the default), then the engine always appends the hard
// rules. Worker execution params (base_branch, commands, ...) feed the vars;
// they default sensibly until feat-loopsv2-execparams-001 surfaces them.
function buildExecutionPrompt(loop, task, instructions, repoPath) {
  const tpl = require('./loopPromptTemplate');
  const { normalizeWorker } = require('./loops');
  const w = normalizeWorker(loop && loop.worker);
  const baseBranch = w.base_branch;
  const branchPrefix = w.branch_prefix;
  const branch = `${branchPrefix}${task.id}`;
  const pr_step = w.open_pr === false
    ? `Do NOT open a PR — push \`${branch}\` and report the branch name; a human will open the PR. Then set the task to \`review\`.`
    : `Open a${w.draft_pr ? ' DRAFT' : ''} PR against \`${baseBranch}\` (e.g. \`gh pr create --base ${baseBranch} --head ${branch}${w.draft_pr ? ' --draft' : ''}\`) referencing the task, then set the task to \`review\` via the API.`;
  const checks_note = w.require_checks_pass === false
    ? '(Checks are advisory for this loop — run them if quick, but they need not all pass.)'
    : '(All of the above that are set MUST pass before you open the PR.)';
  const vars = {
    task_id: task.id,
    task_title: task.title,
    task_description: (task.content || '(no description)').slice(0, 4000),
    repo_path: repoPath,
    base_branch: baseBranch,
    branch,
    setup_command: w.setup_command,
    test_command: w.test_command,
    lint_command: w.lint_command,
    build_command: w.build_command,
    instructions: instructions || '',
    extra_context: (loop && loop.extra_context) || '',
    port: PORT,
    final_status: 'review',
    checks_note,
    pr_step,
  };
  return tpl.build(loop && loop.prompt_template, vars);
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
