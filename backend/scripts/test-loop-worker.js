#!/usr/bin/env node
/**
 * Tests for worker mode (feat-loopsv2-worker-001): loop `mode` field, the
 * execution-prompt builder, and worker eligibility. Live claim/spawn is manual.
 * Run: node scripts/test-loop-worker.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = path.join(os.tmpdir(), `atrium-worker-loops-${process.pid}.json`);
process.env.ATRIUM_LOOPS_FILE = TMP;

const loops = require('../lib/loops');
const executor = require('../lib/loopExecutor');
const { isEligibleForWorker } = require('../lib/tasks');

let passed = 0;
function ok(cond, msg) { if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1); } passed++; }
function throws(fn, status, msg) { try { fn(); } catch (e) { ok(e.status === status, `${msg} (status ${e.status})`); return; } ok(false, `${msg} (no throw)`); }
function cleanup() { try { fs.unlinkSync(TMP); } catch {} try { fs.unlinkSync(TMP + '.tmp'); } catch {} }

cleanup();
try {
  // mode field — OFF by default
  const a = loops.create({ name: 'W', scope: 'project', project: 'Cairn' });
  ok(a.mode === 'watcher', 'mode defaults to watcher (autonomy off by default)');
  const b = loops.create({ name: 'W2', scope: 'project', project: 'Cairn', mode: 'worker' });
  ok(b.mode === 'worker', 'create with mode worker');
  ok(loops.update(a.id, { mode: 'worker' }).mode === 'worker', 'update mode to worker');
  throws(() => loops.create({ name: 'bad', scope: 'project', project: 'Cairn', mode: 'nope' }), 400, 'invalid mode rejected');
  ok(loops.MODES.join() === 'watcher,worker', 'MODES exported');

  // execution prompt
  const task = { id: 'feat-cairn-009', title: 'Add widget', status: 'in_progress', priority: 'high', type: 'frontend', content: '### Description\nbuild it' };
  const prompt = executor.buildExecutionPrompt({ id: 'loop-x', name: 'X' }, task, 'be careful', '/repo/cairn');
  ok(prompt.includes('feat-cairn-009') && prompt.includes('Add widget'), 'prompt names the task');
  ok(prompt.includes('/repo/cairn'), 'prompt includes repo path');
  ok(prompt.includes('loop/feat-cairn-009'), 'prompt branch name contains task id');
  ok(prompt.includes('be careful'), 'prompt embeds loop instructions');
  ok(/NEVER merge/i.test(prompt) && /NEVER push to `main`/i.test(prompt), 'prompt forbids merge + push to main');
  ok(prompt.includes('review'), 'prompt sets task to review');

  // eligibility
  const base = { id: 'feat-c-001', status: 'todo', project: 'Cairn', assignee: null, tags: [] };
  ok(isEligibleForWorker(base, 'Cairn', 'loop:x') === true, 'eligible: todo + project + unassigned');
  ok(isEligibleForWorker({ ...base, status: 'in_progress' }, 'Cairn', 'loop:x') === false, 'not eligible: not todo');
  ok(isEligibleForWorker({ ...base, project: 'Other' }, 'Cairn', 'loop:x') === false, 'not eligible: wrong project');
  ok(isEligibleForWorker({ ...base, assignee: 'someone' }, 'Cairn', 'loop:x') === false, 'not eligible: assigned to another');
  ok(isEligibleForWorker({ ...base, assignee: 'loop:x' }, 'Cairn', 'loop:x') === true, 'eligible: assigned to this worker');
  ok(isEligibleForWorker({ ...base, tags: ['no-code'] }, 'Cairn', 'loop:x') === false, 'not eligible: no-code task');

  console.log(`\nAll ${passed} loop-worker assertions passed.`);
} finally {
  cleanup();
}
