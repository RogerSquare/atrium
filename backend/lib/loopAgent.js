const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { LOOP_RUNS_DIR, MAX_LOOP_RUNS_PER_LOOP } = require('./constants');
const { logger } = require('./logger');
const { getIO } = require('./io');
const github = require('./github');
const { resolveClaudeBin } = require('./claudeBin');

/**
 * AI-summary agent runs for loops (feat-loops-hook-agent-001).
 *
 * Decision (locked): DIRECT headless capture — the backend spawns
 * `claude -p --output-format json` with a fully self-contained prompt and
 * captures the entire run (the exact prompt + structured inputs + the model
 * output + session_id + cost + duration) into a reviewable RUN RECORD. No
 * Claude Code hooks / no edits to the user's global .claude config.
 *
 * Every run is persisted so the full context can be reviewed later, and
 * streamed to the UI via the `loop_run_updated` socket event as it progresses
 * (running -> done/error).
 */

const RUN_TIMEOUT_MS = 180000; // hard cap so a stuck agent can't hang forever
const activeRuns = new Set();  // loopId currently summarizing (light dedupe)

// --- Persistence ---------------------------------------------------------

function loopDir(loopId) {
  return path.join(LOOP_RUNS_DIR, loopId.replace(/[^a-zA-Z0-9_-]/g, '_'));
}

function saveRun(run) {
  const dir = loopDir(run.loop_id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${run.id}.json.tmp`);
  const dst = path.join(dir, `${run.id}.json`);
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
  fs.renameSync(tmp, dst);
  pruneRuns(run.loop_id);
}

function listRuns(loopId) {
  const dir = loopDir(loopId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function getRun(loopId, runId) {
  const p = path.join(loopDir(loopId), `${runId}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function pruneRuns(loopId) {
  const dir = loopDir(loopId);
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(MAX_LOOP_RUNS_PER_LOOP)) {
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
  }
}

function emitRun(run) {
  try { const io = getIO(); if (io) io.emit('loop_run_updated', run); } catch { /* io not ready */ }
}

// --- Context + prompt (pure, exported for tests) -------------------------

// The structured inputs the agent is given — this IS the "context to review".
function buildContext(loop, { task, prNumber, prChanges, event, link }) {
  return {
    event: event || 'manual',
    loop: { id: loop.id, name: loop.name, project: loop.project },
    // The effective instructions (per-loop override or generated default) so
    // editing a loop's instructions actually changes the agent's behavior.
    loop_instructions: require('./loopInstructions').resolve(loop),
    task: task ? { id: task.id, title: task.title, status: task.status } : null,
    pr: {
      number: prNumber,
      url: (prChanges && prChanges.pr_url) || (link && link.pr_url) || null,
      title: (prChanges && prChanges.pr_title) || (link && link.pr_title) || null,
      state: link && link.pr_state ? link.pr_state : null,
      ci_status: link && link.ci_status ? link.ci_status : null,
      review_decision: link && link.review_decision ? link.review_decision : null,
      base_branch: prChanges && prChanges.base_branch,
      head_branch: prChanges && prChanges.head_branch,
      additions: prChanges && prChanges.additions,
      deletions: prChanges && prChanges.deletions,
      changed_files: prChanges && prChanges.changed_files,
    },
    commits: (prChanges && prChanges.commits ? prChanges.commits : []).map((c) => ({
      sha: c.abbreviated_oid, message: c.message_headline, author: c.author && (c.author.login || c.author.name),
    })),
    files: (prChanges && prChanges.files ? prChanges.files : []).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    generated_at: new Date().toISOString(),
  };
}

function buildPrompt(context) {
  const reason = {
    pr_opened: 'A pull request was just opened.',
    pr_merged: 'A pull request was just merged.',
    ci_failed: 'CI just failed on a pull request.',
    manual: 'A reviewer requested a summary.',
  }[context.event] || `Event: ${context.event}.`;
  return [
    'You are an assistant on a task board. Summarize a GitHub pull request for a busy reviewer.',
    reason,
    '',
    ...(context.loop_instructions ? ['LOOP INSTRUCTIONS (this loop\'s configured policy — follow it):', context.loop_instructions, ''] : []),
    'Write a concise review summary (under 180 words) covering: what changed and why, the riskiest areas to look at, and whether it appears ready to merge. Use short bullet points. Do not invent details beyond the data provided.',
    '',
    'PULL REQUEST DATA (JSON):',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
    '',
    'Respond with only the summary.',
  ].join('\n');
}

// --- Agent spawn ---------------------------------------------------------

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const { bin } = resolveClaudeBin();
    // Self-contained prompt -> no tools needed -> no permission prompts. Prompt
    // goes via stdin to avoid any arg-quoting issues. Run in a neutral cwd so a
    // project CLAUDE.md isn't pulled into context (keeps it cheap + focused).
    const child = spawn(bin, ['-p', '--output-format', 'json'], {
      cwd: os.tmpdir(),
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('agent timed out')); }, RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
      try {
        const json = JSON.parse(stdout);
        resolve({
          output: (json.result || '').trim(),
          session_id: json.session_id || null,
          cost_usd: json.total_cost_usd ?? null,
          usage: json.usage || null,
          duration_ms: json.duration_ms ?? null,
          is_error: json.is_error === true,
        });
      } catch (e) {
        reject(new Error(`could not parse claude output: ${e.message}; raw=${stdout.slice(0, 300)}`));
      }
    });
    try { child.stdin.write(prompt); child.stdin.end(); } catch (e) { clearTimeout(timer); reject(e); }
  });
}

// --- Public: summarize ---------------------------------------------------

// Resolve a task's linked PR number (when the caller passed only a task id).
async function resolvePrForTask(loop, taskId) {
  const { getAllTasks } = require('./tasks');
  const { TASKS_DIR } = require('./constants');
  const registry = require('./projectRegistry');
  const proj = registry.resolve(loop.project);
  if (!proj) return { prNumber: null, link: null };
  const tasks = getAllTasks(TASKS_DIR)
    .filter((t) => (t.project || 'Root') === proj.folder && t.id)
    .map((t) => ({ id: t.id, github_branch: t.github_branch || null, github_pr_url: t.github_pr_url || null }));
  const links = await github.getLinks(loop.project, tasks, { refresh: false });
  const link = links.by_task_id ? links.by_task_id[taskId] : null;
  return { prNumber: link && link.pr_number, link };
}

/**
 * Run an AI summary for a loop. Returns the run record (also persisted +
 * streamed via socket). `taskId` optional; `prNumber` optional (resolved from
 * the task when omitted); `event` defaults to 'manual'.
 */
async function summarize(loop, { taskId = null, prNumber = null, event = 'manual' } = {}) {
  const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let link = null;
  if (!prNumber && taskId) {
    const r = await resolvePrForTask(loop, taskId);
    prNumber = r.prNumber; link = r.link;
  }

  const run = {
    id, loop_id: loop.id, task_id: taskId, pr_number: prNumber, event,
    status: 'running', created_at: new Date().toISOString(), started_at: new Date().toISOString(),
    finished_at: null, duration_ms: null, model: 'claude-cli', session_id: null,
    cost_usd: null, usage: null, context: null, output: null, error: null,
  };

  if (!prNumber) {
    run.status = 'error';
    run.error = 'No linked PR to summarize (task has no PR, and no pr_number given).';
    run.finished_at = new Date().toISOString();
    saveRun(run); emitRun(run);
    return run;
  }

  saveRun(run); emitRun(run);
  try {
    const { getAllTasks } = require('./tasks');
    const { TASKS_DIR } = require('./constants');
    const task = taskId ? getAllTasks(TASKS_DIR).find((t) => t.id === taskId) : null;
    const prChanges = await github.getPrChanges(loop.project, prNumber, { refresh: false });
    if (prChanges && prChanges.error) throw new Error(`getPrChanges: ${prChanges.error}`);

    const context = buildContext(loop, { task, prNumber, prChanges, event, link });
    const prompt = buildPrompt(context);
    run.context = { prompt, data: context }; // full reviewable context
    saveRun(run); emitRun(run);

    const res = await runClaude(prompt);
    run.status = res.is_error ? 'error' : 'done';
    run.output = res.output;
    run.session_id = res.session_id;
    run.cost_usd = res.cost_usd;
    run.usage = res.usage;
    run.duration_ms = res.duration_ms;
    run.finished_at = new Date().toISOString();
    if (res.is_error) run.error = 'agent reported an error';
    saveRun(run); emitRun(run);
    require('./loopActivity').append(loop.id, { type: 'ai_summary', message: `AI summary of PR #${prNumber} (${event}) — ${run.status}${run.cost_usd != null ? ` · $${Number(run.cost_usd).toFixed(4)}` : ''}`, refs: { run_id: id, pr_number: prNumber, task_id: taskId } });

    // Append the summary as a task comment when tied to a task.
    if (taskId && run.status === 'done' && run.output) {
      try {
        const { appendComment } = require('./tasks');
        await appendComment(taskId,
          `- **[loop:${loop.name}]** AI summary of PR #${prNumber} (${event}):\n${run.output.split('\n').map((l) => `  ${l}`).join('\n')}\n  - _full context: Loops view -> this loop -> run ${id}_`,
          `loop:${loop.id}`);
      } catch (e) { logger.warn({ err: e.message, taskId }, 'loop: failed to append summary comment'); }
    }
    return run;
  } catch (err) {
    run.status = 'error';
    run.error = String((err && err.message) || err);
    run.finished_at = new Date().toISOString();
    saveRun(run); emitRun(run);
    logger.warn({ err: run.error, loopId: loop.id }, 'loop: AI summary failed');
    return run;
  }
}

// --- Public: playbook runs (feat-hub-rethink-impl-001) --------------------
//
// A playbook loop's tick IS an agent run: execute the loop's instructions on
// schedule with a small board-context block. Same no-tools posture and run
// record as summaries (cost tracked for free); output lives in run history —
// v1 writes nothing to the board.

function buildPlaybookContext(loop) {
  let board = null;
  if (loop.scope === 'project' && loop.project) {
    try {
      const { getAllTasks } = require('./tasks');
      const { TASKS_DIR } = require('./constants');
      const registry = require('./projectRegistry');
      const proj = registry.resolve(loop.project);
      if (proj) {
        const tasks = getAllTasks(TASKS_DIR).filter((t) => (t.project || 'Root') === proj.folder);
        const task_counts = {};
        for (const t of tasks) task_counts[t.status] = (task_counts[t.status] || 0) + 1;
        board = { project: loop.project, total_tasks: tasks.length, task_counts };
      }
    } catch { /* board context is best-effort */ }
  }
  return {
    kind: 'playbook',
    loop: { id: loop.id, name: loop.name, project: loop.project || null },
    playbook: require('./loopInstructions').resolve(loop),
    board,
    generated_at: new Date().toISOString(),
  };
}

function buildPlaybookPrompt(context) {
  return [
    `You are the agent behind the scheduled playbook loop "${context.loop.name}". Execute the playbook below using only the data provided — you have no tools and no filesystem.`,
    '',
    'PLAYBOOK (this loop\'s configured instructions — follow them):',
    context.playbook,
    '',
    'CONTEXT (JSON):',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
    '',
    'Respond with only the playbook output.',
  ].join('\n');
}

/** Run a playbook loop once. Returns the persisted run record. */
async function runPlaybook(loop, { event = 'schedule' } = {}) {
  const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const run = {
    id, loop_id: loop.id, kind: 'playbook', task_id: null, pr_number: null, event,
    status: 'running', created_at: new Date().toISOString(), started_at: new Date().toISOString(),
    finished_at: null, duration_ms: null, model: 'claude-cli', session_id: null,
    cost_usd: null, usage: null, context: null, output: null, error: null,
  };
  saveRun(run); emitRun(run);
  try {
    const context = buildPlaybookContext(loop);
    const prompt = buildPlaybookPrompt(context);
    run.context = { prompt, data: context }; // full reviewable context
    saveRun(run); emitRun(run);

    const res = await runClaude(prompt);
    run.status = res.is_error ? 'error' : 'done';
    run.output = res.output;
    run.session_id = res.session_id;
    run.cost_usd = res.cost_usd;
    run.usage = res.usage;
    run.duration_ms = res.duration_ms;
    run.finished_at = new Date().toISOString();
    if (res.is_error) run.error = 'agent reported an error';
    saveRun(run); emitRun(run);
    require('./loopActivity').append(loop.id, { type: 'playbook_run', message: `Playbook run (${event}) — ${run.status}${run.cost_usd != null ? ` · $${Number(run.cost_usd).toFixed(4)}` : ''}`, refs: { run_id: id } });
    return run;
  } catch (err) {
    run.status = 'error';
    run.error = String((err && err.message) || err);
    run.finished_at = new Date().toISOString();
    saveRun(run); emitRun(run);
    require('./loopActivity').append(loop.id, { type: 'error', message: `Playbook run failed: ${run.error}`, refs: { run_id: id } });
    logger.warn({ err: run.error, loopId: loop.id }, 'loop: playbook run failed');
    return run;
  }
}

// Fire-and-forget wrapper for the engine (must never block / throw into a tick).
function summarizeAsync(loop, opts) {
  if (activeRuns.has(loop.id)) return; // avoid piling up runs for one loop
  activeRuns.add(loop.id);
  summarize(loop, opts).catch((e) => logger.warn({ err: e.message }, 'loop summarizeAsync')).finally(() => activeRuns.delete(loop.id));
}

module.exports = {
  summarize, summarizeAsync, runPlaybook, listRuns, getRun,
  buildContext, buildPrompt, buildPlaybookContext, buildPlaybookPrompt, // exported for tests
};
