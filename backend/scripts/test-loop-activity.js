#!/usr/bin/env node
/**
 * Tests for the per-loop activity/audit trail (feat-loopsv2-activity-001).
 * Uses a throwaway LOOP_RUNS_DIR. Run: node scripts/test-loop-activity.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = path.join(os.tmpdir(), `atrium-loop-activity-test-${process.pid}`);
process.env.ATRIUM_LOOP_RUNS_DIR = TMP;

const activity = require('../lib/loopActivity');

let passed = 0;
function ok(cond, msg) { if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1); } passed++; }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }

rmrf(TMP);
try {
  ok(activity.list('loop-x').length === 0, 'empty initially');

  const e = activity.append('loop-x', { type: 'comment', message: 'Commented on feat-a-001', refs: { task_id: 'feat-a-001' } });
  ok(e && e.id.startsWith('act-') && e.type === 'comment' && e.refs.task_id === 'feat-a-001' && e.ts, 'append returns shaped entry');

  activity.append('loop-x', { type: 'status_move', message: 'moved to review', refs: { task_id: 'feat-a-001' } });
  const list = activity.list('loop-x');
  ok(list.length === 2, 'two entries recorded');
  ok(list[0].type === 'status_move', 'list is newest-first');

  ok(activity.append('loop-x', {}) === null || activity.list('loop-x').length === 2 + 0, 'append with no type is a no-op-ish');
  ok(activity.append(null, { type: 'x' }) === null, 'append with no loopId -> null');

  // isolation between loops
  activity.append('loop-y', { type: 'tick', message: 'y tick' });
  ok(activity.list('loop-y').length === 1 && activity.list('loop-x').length >= 2, 'per-loop isolation');

  // cap
  for (let i = 0; i < activity.MAX_ENTRIES + 25; i++) activity.append('loop-cap', { type: 'tick', message: `t${i}` });
  ok(activity.list('loop-cap').length === activity.MAX_ENTRIES, `capped at ${activity.MAX_ENTRIES}`);
  ok(activity.list('loop-cap')[0].message === `t${activity.MAX_ENTRIES + 24}`, 'newest kept after cap');

  console.log(`\nAll ${passed} loop-activity assertions passed.`);
} finally {
  rmrf(TMP);
}
