#!/usr/bin/env node
/**
 * Tests for worker execution-policy params (feat-loopsv2-execparams-001):
 * loop.worker schema/defaults/normalize/merge + how they shape the prompt.
 * Run: node scripts/test-loop-execparams.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = path.join(os.tmpdir(), `atrium-execparams-loops-${process.pid}.json`);
process.env.ATRIUM_LOOPS_FILE = TMP;

const loops = require('../lib/loops');
const { buildExecutionPrompt } = require('../lib/loopExecutor');

let passed = 0;
function ok(cond, msg) { if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1); } passed++; }
function throws(fn, status, msg) { try { fn(); } catch (e) { ok(e.status === status, `${msg} (status ${e.status})`); return; } ok(false, `${msg} (no throw)`); }
function cleanup() { try { fs.unlinkSync(TMP); } catch {} try { fs.unlinkSync(TMP + '.tmp'); } catch {} }

cleanup();
try {
  // normalizeWorker
  ok(JSON.stringify(loops.normalizeWorker()) === JSON.stringify(loops.WORKER_DEFAULTS), 'normalizeWorker() -> defaults');
  ok(loops.normalizeWorker({ base_branch: '   ' }).base_branch === 'main', 'blank base_branch -> main');
  ok(loops.normalizeWorker({ open_pr: 'yes' }).open_pr === true, 'non-boolean open_pr -> default true');
  ok(loops.normalizeWorker(null).branch_prefix === 'loop/', 'null worker -> defaults');
  ok(loops.normalizeWorker({ test_command: 'npm test', draft_pr: true }).test_command === 'npm test', 'string passthrough');
  ok(loops.normalizeWorker({ draft_pr: true }).draft_pr === true && loops.normalizeWorker({ draft_pr: true }).open_pr === true, 'partial keeps other defaults');

  // create
  const a = loops.create({ name: 'W', scope: 'project', project: 'Cairn' });
  ok(JSON.stringify(a.worker) === JSON.stringify(loops.WORKER_DEFAULTS), 'create -> default worker block');
  const b = loops.create({ name: 'W2', scope: 'project', project: 'Cairn', worker: { base_branch: 'develop', test_command: 'pnpm test', draft_pr: true } });
  ok(b.worker.base_branch === 'develop' && b.worker.test_command === 'pnpm test' && b.worker.draft_pr === true && b.worker.open_pr === true, 'create merges given worker fields onto defaults');

  // update deep-merges (doesn't drop other worker fields)
  const u = loops.update(b.id, { worker: { lint_command: 'eslint .' } });
  ok(u.worker.lint_command === 'eslint .' && u.worker.base_branch === 'develop' && u.worker.test_command === 'pnpm test', 'update deep-merges worker (keeps prior fields)');

  // validation
  throws(() => loops.create({ name: 'bad', scope: 'project', project: 'Cairn', worker: [] }), 400, 'worker array rejected');

  // prompt reflects params
  const mk = (wk) => buildExecutionPrompt({ id: 'loop-1', worker: wk }, { id: 'feat-z-003', title: 'Z', content: 'do z' }, 'policy', '/repo/z');
  const draft = mk({ base_branch: 'develop', draft_pr: true, test_command: 'pnpm test' });
  ok(draft.includes('loop/feat-z-003') && draft.includes('against `develop`'), 'prompt branch + base branch reflected');
  ok(draft.includes('DRAFT') && draft.includes('--draft'), 'draft_pr reflected in prompt');
  ok(draft.includes('pnpm test'), 'test_command reflected');
  ok(draft.includes('NEVER push to `develop`'), 'hard rules use configured base branch');
  const noPr = mk({ open_pr: false });
  ok(noPr.includes('Do NOT open a PR'), 'open_pr=false -> no-PR instruction');
  const advisory = mk({ require_checks_pass: false });
  ok(/advisory/i.test(advisory), 'require_checks_pass=false -> advisory checks note');

  console.log(`\nAll ${passed} loop-execparams assertions passed.`);
} finally {
  cleanup();
}
