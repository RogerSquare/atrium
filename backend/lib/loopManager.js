const loops = require('./loops');
const github = require('./github');
const registry = require('./projectRegistry');
const { getIO } = require('./io');
const { logger } = require('./logger');
const { TASKS_DIR } = require('./constants');

/**
 * Loop engine (feat-loops-engine-001)
 *
 * The heartbeat for GitHub-watcher loops: schedules each enabled loop, polls
 * GitHub (reusing lib/github.js), diffs the result against the loop's stored
 * snapshot, and applies DETERMINISTIC actions — update task github fields,
 * move a task to review on PR merge, and append a comment describing changes.
 *
 * AI summaries are NOT spawned here: `requestSummary()` is a no-op hook point
 * that feat-loops-hook-agent-001 (Phase 3) fills in with a hook-tracked
 * headless Claude Code run. This phase is deterministic-only.
 *
 * Scope: project loops are fully supported (they map to a local repo via the
 * project registry + workingDirectory, which lib/github.js already resolves).
 * Global (arbitrary owner/repo) loops are accepted by the model but not yet
 * polled here — they no-op with a note until a later enhancement.
 */

const timers = new Map();   // loopId -> Timeout
const running = new Set();  // loopIds with an in-flight tick (overlap guard)

const HIGH_SIGNAL = new Set(['pr_opened', 'pr_merged', 'ci_failed']);

// --- Pure helpers (exported for tests) -----------------------------------

// Reduce a github.js link entry to the fields the engine tracks/diffs.
function normalizeEntry(entry) {
  if (!entry) return null;
  return {
    pr_number: entry.pr_number ?? null,
    pr_url: entry.pr_url ?? null,
    pr_state: entry.pr_state ?? null,
    review_decision: entry.review_decision ?? null,
    ci_status: entry.ci_status ?? null,
    branch: entry.branch ?? null,
    branch_sha: entry.branch_sha ?? null,
  };
}

/**
 * Compare a previous snapshot entry to the current one and emit typed events,
 * filtered by the loop's `watch` list. `prev == null` means "never seen" — a
 * baseline pass that records state without firing events (avoids a flood of
 * comments for every pre-existing PR on first run).
 */
function detectChanges(prev, cur, watch = []) {
  if (!prev) return { baseline: true, events: [] };
  const events = [];
  const w = (t) => watch.includes(t);

  if (w('prs') && prev.pr_state !== cur.pr_state) {
    if (cur.pr_state === 'OPEN' && (prev.pr_state == null)) events.push({ type: 'pr_opened' });
    else if (cur.pr_state === 'MERGED') events.push({ type: 'pr_merged' });
    else if (cur.pr_state === 'CLOSED') events.push({ type: 'pr_closed' });
    else events.push({ type: 'pr_state_changed', from: prev.pr_state, to: cur.pr_state });
  }
  if (w('prs') && prev.review_decision !== cur.review_decision && cur.review_decision) {
    events.push({ type: 'review_changed', from: prev.review_decision, to: cur.review_decision });
  }
  if (w('ci') && prev.ci_status !== cur.ci_status) {
    if (cur.ci_status === 'FAILURE') events.push({ type: 'ci_failed' });
    else if (prev.ci_status === 'FAILURE' && cur.ci_status === 'SUCCESS') events.push({ type: 'ci_recovered' });
    else if (cur.ci_status) events.push({ type: 'ci_changed', from: prev.ci_status, to: cur.ci_status });
  }
  // 'commits' detection is wired here but enriched in feat-loops-watch-types-001.
  if (w('commits') && cur.branch_sha && prev.branch_sha !== cur.branch_sha) {
    events.push({ type: 'commits', from: prev.branch_sha, to: cur.branch_sha });
  }
  return { baseline: false, events };
}

function describeEvents(events, cur) {
  const prRef = cur.pr_number ? `PR #${cur.pr_number}` : 'the linked PR';
  const lines = events.map((e) => {
    switch (e.type) {
      case 'pr_opened': return `- ${prRef} opened`;
      case 'pr_merged': return `- ${prRef} merged`;
      case 'pr_closed': return `- ${prRef} closed`;
      case 'pr_state_changed': return `- ${prRef} state: ${e.from || 'none'} -> ${e.to || 'none'}`;
      case 'review_changed': return `- ${prRef} review: ${e.to}`;
      case 'ci_failed': return `- CI failed on ${prRef}`;
      case 'ci_recovered': return `- CI recovered on ${prRef}`;
      case 'ci_changed': return `- CI on ${prRef}: ${e.from || 'none'} -> ${e.to || 'none'}`;
      case 'commits': return `- New commits on \`${cur.branch}\` (${(e.to || '').slice(0, 7)})`;
      default: return `- ${e.type}`;
    }
  });
  return lines.join('\n');
}

// --- Issues (feat-loops-watch-types-001) ---------------------------------

// Deterministic id for an issue-imported task. `feat-issue-<num>-001` satisfies
// the canonical task-id regex and is stable per issue so re-runs don't dup.
function issueTaskId(num) {
  return `feat-issue-${num}-001`;
}

// Pure: issues present now but not in the prior snapshot map. Exported for tests.
// `prevIssues` is the snapshot.issues object ({ [number]: updatedAt }).
function detectNewIssues(prevIssues, issues) {
  const prev = prevIssues || {};
  return (issues || []).filter((i) => i && i.number != null && !(i.number in prev));
}

// Fetch open issues, create a draft task per previously-unseen one (decision 3),
// and return the new snapshot.issues map. Gated by the caller on watch:'issues'.
async function handleIssues(loop, prevIssues) {
  const { createTask } = require('./tasks');
  const data = await github.getIssues(loop.project, { refresh: true });
  const issues = data.issues || [];
  const snapshotIssues = {};
  for (const i of issues) snapshotIssues[i.number] = i.updatedAt || null;

  let created = 0;
  for (const issue of detectNewIssues(prevIssues, issues)) {
    const id = issueTaskId(issue.number);
    try {
      createTask({
        id,
        title: `Issue #${issue.number}: ${issue.title}`.slice(0, 200),
        status: 'draft',
        type: 'fullstack',
        project: loop.project,
        tags: ['from-github-issue'],
        content: `### Description\nImported from GitHub issue [#${issue.number}](${issue.url}) by loop "${loop.name}".\n\n- [ ] Triage and scope\n\n### Comments\n`,
        created_by: `loop:${loop.id}`,
      });
      created++;
      require('./loopActivity').append(loop.id, { type: 'task_created', message: `Created draft ${id} from issue #${issue.number}: ${issue.title}`, refs: { task_id: id } });
    } catch (err) {
      // 409 = the task already exists (snapshot lost but file persisted) — skip quietly.
      if (err.status !== 409) logger.warn({ err: err.message, id, loopId: loop.id }, 'loop: failed to create task from issue');
    }
  }
  return { snapshotIssues, created };
}

// --- Phase 3 hook point --------------------------------------------------

// feat-loops-hook-agent-001: spawn a headless `claude -p` summary run for the
// first high-signal event, capturing full context into a reviewable run record.
// Fire-and-forget so it never blocks/throws into the tick.
function requestSummary(loop, taskId, events, cur) {
  const loopAgent = require('./loopAgent');
  const event = (events.find((e) => HIGH_SIGNAL.has(e.type)) || events[0]).type;
  loopAgent.summarizeAsync(loop, { taskId, prNumber: cur && cur.pr_number, event });
}

// --- Actions -------------------------------------------------------------

async function applyFieldUpdates(loop, task, cur) {
  const { updateTaskField } = require('./tasks');
  const activity = require('./loopActivity');
  const actor = `loop:${loop.id}`;
  if (cur.pr_url && task.github_pr_url !== cur.pr_url) {
    await updateTaskField(task.id, 'github_pr_url', cur.pr_url, actor, 'github_pr_url set by loop');
    activity.append(loop.id, { type: 'field_update', message: `Linked ${task.id} to ${cur.pr_url}`, refs: { task_id: task.id, pr_url: cur.pr_url, pr_number: cur.pr_number } });
  }
  if (cur.branch && task.github_branch !== cur.branch) {
    await updateTaskField(task.id, 'github_branch', cur.branch, actor, 'github_branch set by loop');
    activity.append(loop.id, { type: 'field_update', message: `Set ${task.id} branch to ${cur.branch}`, refs: { task_id: task.id } });
  }
}

async function postComment(loop, task, events, cur) {
  const { appendComment } = require('./tasks');
  const activity = require('./loopActivity');
  const body = [
    `- **[loop:${loop.name}]**: GitHub changes detected${cur.pr_url ? ` ([${cur.pr_number ? `#${cur.pr_number}` : 'PR'}](${cur.pr_url}))` : ''}.`,
    describeEvents(events, cur).split('\n').map((l) => `  ${l}`).join('\n'),
  ].join('\n');
  await appendComment(task.id, body, `loop:${loop.id}`);
  activity.append(loop.id, { type: 'comment', message: `Commented on ${task.id}: ${events.map((e) => e.type).join(', ')}`, refs: { task_id: task.id, pr_number: cur.pr_number, pr_url: cur.pr_url } });
}

// Decision 1 (locked): on PR merge, move the task to review IF it's mid-flight.
// Never auto-`done` (human-only) and don't yank drafts/waiting_input forward.
async function applyMergePolicy(loop, task) {
  const { updateTaskField } = require('./tasks');
  const activity = require('./loopActivity');
  if (task.status === 'todo' || task.status === 'in_progress') {
    const actor = `loop:${loop.id}`;
    await updateTaskField(task.id, 'reviewed_at', new Date().toISOString(), actor, null);
    await updateTaskField(task.id, 'status', 'review', actor, 'Moved to review on PR merge by loop');
    activity.append(loop.id, { type: 'status_move', message: `Moved ${task.id} ${task.status} -> review (PR merged)`, refs: { task_id: task.id } });
  }
}

// --- Tick ----------------------------------------------------------------

async function runTick(loop) {
  if (loop.scope !== 'project') {
    return {
      result: { changes: 0, note: 'global-scope loops are not yet polled by the engine (project loops only)' },
      snapshot: loop.snapshot,
    };
  }

  const proj = registry.resolve(loop.project);
  if (!proj) {
    return { result: { changes: 0, note: `project not found: ${loop.project}` }, snapshot: loop.snapshot };
  }

  const { getAllTasks } = require('./tasks');
  const allTasks = getAllTasks(TASKS_DIR);
  const projectTasks = allTasks.filter((t) => (t.project || 'Root') === proj.folder && t.id);
  const taskById = new Map(projectTasks.map((t) => [t.id, t]));
  const projections = projectTasks.map((t) => ({
    id: t.id,
    github_branch: t.github_branch || null,
    github_pr_url: t.github_pr_url || null,
  }));

  // refresh:true so a short interval isn't blinded by the 5-min links cache;
  // the snapshot diff is the change detector, not the cache.
  const links = await github.getLinks(loop.project, projections, { refresh: true });
  if (links.reason === 'no_git_repo') {
    return { result: { changes: 0, note: `no git repo for project ${loop.project}` }, snapshot: loop.snapshot };
  }

  const prevPrs = (loop.snapshot && loop.snapshot.prs) || {};
  const nextPrs = {};
  const changed = [];

  for (const [taskId, entry] of Object.entries(links.by_task_id || {})) {
    const cur = normalizeEntry(entry);
    nextPrs[taskId] = cur;
    const task = taskById.get(taskId);
    const { baseline, events } = detectChanges(prevPrs[taskId], cur, loop.watch);

    if (task && loop.actions.includes('update_fields')) {
      await applyFieldUpdates(loop, task, cur);
    }
    if (baseline || events.length === 0) continue;

    if (task && loop.actions.includes('comment')) {
      await postComment(loop, task, events, cur);
    }
    if (task && events.some((e) => e.type === 'pr_merged')) {
      await applyMergePolicy(loop, task);
    }
    if (loop.actions.includes('ai_summary') && events.some((e) => HIGH_SIGNAL.has(e.type))) {
      requestSummary(loop, taskId, events, cur);
    }
    changed.push({ taskId, events: events.map((e) => e.type) });
  }

  // Issues -> draft tasks (only when watched). Independent of the PR loop.
  let nextIssues = (loop.snapshot && loop.snapshot.issues) || {};
  let issuesCreated = 0;
  if (loop.watch.includes('issues')) {
    const res = await handleIssues(loop, nextIssues);
    nextIssues = res.snapshotIssues;
    issuesCreated = res.created;
  }

  const snapshot = {
    prs: nextPrs,
    branches: (loop.snapshot && loop.snapshot.branches) || {},
    issues: nextIssues,
  };
  return {
    result: { changes: changed.length, issues_created: issuesCreated, detail: changed, fetched_at: links.fetched_at },
    snapshot,
  };
}

// Worker mode (feat-loopsv2-worker-001): claim the next eligible todo in the
// project and dispatch the autonomous executor. One task at a time per loop.
// Only reached when loop.mode === 'worker' AND the loop is enabled (off by
// default — mode defaults to 'watcher').
async function runWorkerTick(loop) {
  if (loop.scope !== 'project') {
    return { result: { note: 'worker mode requires a project-scoped loop' }, snapshot: loop.snapshot };
  }
  const executor = require('./loopExecutor');
  if (executor.isExecuting(loop.id)) {
    return { result: { note: 'executor busy (one task at a time)' }, snapshot: loop.snapshot };
  }
  const proj = registry.resolve(loop.project);
  if (!proj) return { result: { note: `project not found: ${loop.project}` }, snapshot: loop.snapshot };

  const { claimNextTodo } = require('./tasks');
  const task = await claimNextTodo(proj.folder, `loop:${loop.id}`);
  if (!task) return { result: { claimed: 0, note: 'no eligible todo' }, snapshot: loop.snapshot };

  require('./loopActivity').append(loop.id, { type: 'task_claimed', message: `Claimed ${task.id}: ${task.title}`, refs: { task_id: task.id } });
  executor.run(loop, task); // fire-and-forget; streams to the Terminal tab
  return { result: { claimed: 1, task: task.id, note: 'executor dispatched' }, snapshot: loop.snapshot };
}

function emitUpdated(loop) {
  if (!loop) return;
  try {
    const io = getIO();
    if (io) io.emit('loop_updated', loop);
  } catch { /* io not ready */ }
}

async function tick(loopId) {
  if (running.has(loopId)) return null; // overlap guard
  const loop = loops.get(loopId);
  if (!loop) return null;

  running.add(loopId);
  emitUpdated(loops.patchRuntime(loopId, { status: 'running', last_run_at: new Date().toISOString() }));
  try {
    const { result, snapshot } = loop.mode === 'worker' ? await runWorkerTick(loop) : await runTick(loop);
    const updated = loops.patchRuntime(loopId, {
      status: 'idle',
      last_result: result,
      last_error: null,
      snapshot,
      next_run_at: new Date(Date.now() + loop.interval_ms).toISOString(),
    });
    emitUpdated(updated);
    return updated;
  } catch (err) {
    logger.error({ err, loopId }, 'loop tick failed');
    require('./loopActivity').append(loopId, { type: 'error', message: `Tick failed: ${String((err && err.message) || err)}` });
    const updated = loops.patchRuntime(loopId, {
      status: 'error',
      last_error: String((err && err.message) || err),
      next_run_at: new Date(Date.now() + loop.interval_ms).toISOString(),
    });
    emitUpdated(updated);
    return updated;
  } finally {
    running.delete(loopId);
  }
}

// --- Scheduling ----------------------------------------------------------

function clearTimer(id) {
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
}

function schedule(loop) {
  clearTimer(loop.id);
  if (!loop || !loop.enabled) return;
  const t = setTimeout(async () => {
    await tick(loop.id);
    const fresh = loops.get(loop.id);   // interval/enabled may have changed mid-tick
    if (fresh && fresh.enabled) schedule(fresh);
  }, loop.interval_ms);
  if (t.unref) t.unref(); // don't keep the process alive on its own
  timers.set(loop.id, t);
}

// Called once after server.listen (server.js).
function init() {
  const all = loops.list();
  for (const loop of all) schedule(loop);
  const enabled = all.filter((l) => l.enabled).length;
  logger.info({ total: all.length, enabled }, 'Loop engine started');
}

// CRUD wiring: routes call these so timers track create/update/delete live.
function onLoopChanged(id) {
  const loop = loops.get(id);
  if (!loop) { clearTimer(id); return; }
  schedule(loop);
}
function onLoopRemoved(id) {
  clearTimer(id);
}

// "Run now" — trigger a tick immediately regardless of the timer.
async function runLoopNow(id) {
  await tick(id);
  return loops.get(id);
}

function shutdown() {
  for (const id of [...timers.keys()]) clearTimer(id);
}

module.exports = {
  init, onLoopChanged, onLoopRemoved, runLoopNow, shutdown,
  // exported for tests:
  detectChanges, normalizeEntry, describeEvents, detectNewIssues, issueTaskId, HIGH_SIGNAL,
};
