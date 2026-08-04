// Worker-hardening seams (feat-hub-rethink-impl-001): failure→todo requeue,
// interrupted-run sweep, and the daily executor cap. All via injected deps /
// temp dirs — no PTY spawns, no real task files.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { requeueIfStranded, execRunsToday } = require('./loopExecutor');
const { sweepInterrupted } = require('./loopPty');
const { normalizeWorker } = require('./loops');

const LOOP = { id: 'loop-w', name: 'Worker' };

function fakeDeps(task) {
  const calls = { comments: [], fields: [], activity: [] };
  return {
    calls,
    TASKS_DIR: '/fake',
    getAllTasks: () => (task ? [task] : []),
    appendComment: async (id, body) => { calls.comments.push({ id, body }); },
    updateTaskField: async (id, field, value) => { calls.fields.push({ id, field, value }); },
    activity: { append: (loopId, e) => calls.activity.push({ loopId, ...e }) },
  };
}

test('a stranded task (in_progress, loop-assigned, no PR) is requeued to todo', async () => {
  const deps = fakeDeps({ id: 't-1', status: 'in_progress', assignee: 'loop:loop-w', github_pr_url: null });
  const out = await requeueIfStranded(LOOP, 't-1', { code: 1, runId: 'term-x' }, deps);
  assert.strictEqual(out, true);
  assert.deepStrictEqual(deps.calls.fields.map((f) => [f.field, f.value]), [['assignee', null], ['status', 'todo']]);
  assert.ok(deps.calls.comments[0].body.includes('term-x'));
  assert.strictEqual(deps.calls.activity[0].type, 'executor_failed');
});

test('a task the agent got to review (PR opened) is never yanked back, even on exit!=0', async () => {
  for (const task of [
    { id: 't-2', status: 'review', assignee: 'loop:loop-w', github_pr_url: 'https://x/pr/1' },
    { id: 't-2', status: 'in_progress', assignee: 'loop:loop-w', github_pr_url: 'https://x/pr/1' },
    { id: 't-2', status: 'in_progress', assignee: 'someone-else', github_pr_url: null },
    null, // task vanished
  ]) {
    const deps = fakeDeps(task);
    assert.strictEqual(await requeueIfStranded(LOOP, 't-2', { code: 1, runId: 'r' }, deps), false);
    assert.strictEqual(deps.calls.fields.length, 0);
  }
});

test('sweepInterrupted flips running metas to interrupted and leaves the rest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loopruns-'));
  const d = path.join(root, 'loop-w');
  fs.mkdirSync(d, { recursive: true });
  const mk = (id, status) => fs.writeFileSync(path.join(d, `${id}.termrun.json`),
    JSON.stringify({ run_id: id, loop_id: 'loop-w', kind: 'terminal', label: `execute t-${id}`, status, started_at: '2026-08-01T00:00:00Z', finished_at: null }));
  mk('term-a', 'running');
  mk('term-b', 'done');

  const swept = sweepInterrupted(root);
  assert.deepStrictEqual(swept.map((s) => s.run_id), ['term-a']);
  const a = JSON.parse(fs.readFileSync(path.join(d, 'term-a.termrun.json'), 'utf-8'));
  const b = JSON.parse(fs.readFileSync(path.join(d, 'term-b.termrun.json'), 'utf-8'));
  assert.strictEqual(a.status, 'interrupted');
  assert.ok(a.finished_at);
  assert.strictEqual(b.status, 'done');
  // Second sweep is a no-op — idempotent.
  assert.deepStrictEqual(sweepInterrupted(root), []);
});

test('execRunsToday counts only executor runs started today', () => {
  const now = new Date(2026, 7, 3, 15, 0);
  const iso = (d) => d.toISOString();
  const metas = [
    { label: 'execute t-1', started_at: iso(new Date(2026, 7, 3, 9, 0)) },   // today
    { label: 'execute t-2', started_at: iso(new Date(2026, 7, 3, 14, 0)) },  // today
    { label: 'execute t-3', started_at: iso(new Date(2026, 7, 2, 23, 0)) },  // yesterday
    { label: 'summary of PR #4', started_at: iso(new Date(2026, 7, 3, 9, 0)) }, // not an exec run
    { label: 'execute t-5' }, // no timestamp
  ];
  assert.strictEqual(execRunsToday(metas, now), 2);
  assert.strictEqual(execRunsToday([], now), 0);
});

test('normalizeWorker: max_runs_per_day defaults to 10, floors, and allows 0=unlimited', () => {
  assert.strictEqual(normalizeWorker({}).max_runs_per_day, 10);
  assert.strictEqual(normalizeWorker({ max_runs_per_day: 3.9 }).max_runs_per_day, 3);
  assert.strictEqual(normalizeWorker({ max_runs_per_day: 0 }).max_runs_per_day, 0);
  assert.strictEqual(normalizeWorker({ max_runs_per_day: -5 }).max_runs_per_day, 10);
  assert.strictEqual(normalizeWorker({ max_runs_per_day: 'lots' }).max_runs_per_day, 10);
});
