#!/usr/bin/env node
/**
 * Self-contained tests for the loops data model (feat-loops-model-001).
 * No test framework — run with `node scripts/test-loops.js` (or `npm run test:loops`).
 * Uses a throwaway loops file via ATRIUM_LOOPS_FILE so it never touches real data.
 * Exits non-zero on the first failure.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

// Point the lib at a temp file BEFORE requiring it (constants reads the env at load).
const TMP = path.join(os.tmpdir(), `atrium-loops-test-${process.pid}.json`);
process.env.ATRIUM_LOOPS_FILE = TMP;

const loops = require('../lib/loops');

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1); }
  passed++;
}
function throws(fn, status, msg) {
  try { fn(); } catch (err) { ok(err.status === status, `${msg} (got status ${err.status})`); return; }
  ok(false, `${msg} (no error thrown)`);
}
function cleanup() { try { fs.unlinkSync(TMP); } catch (_) {} try { fs.unlinkSync(TMP + '.tmp'); } catch (_) {} }

cleanup();
try {
  // 1. Empty to start
  ok(Array.isArray(loops.list()) && loops.list().length === 0, 'list() is empty initially');

  // 2. Create a project loop with defaults
  const a = loops.create({ name: 'Atrium PR watcher', scope: 'project', project: 'Atrium' });
  ok(a.id.startsWith('loop-'), 'create() generates a loop- id');
  ok(a.status === 'idle' && a.enabled === true, 'defaults: status idle, enabled true');
  ok(a.interval_ms === loops.DEFAULT_INTERVAL_MS, 'default interval applied');
  ok(JSON.stringify(a.watch) === JSON.stringify(['prs', 'ci']), 'default watch applied');
  ok(a.repo === null && a.snapshot && a.snapshot.prs, 'project loop has null repo + snapshot scaffold');

  // 3. Persistence: a fresh read sees it
  ok(loops.list().length === 1 && loops.get(a.id).name === 'Atrium PR watcher', 'persisted + retrievable by id');

  // 4. Unique ids for same name
  const a2 = loops.create({ name: 'Atrium PR watcher', scope: 'project', project: 'Atrium' });
  ok(a2.id !== a.id, 'duplicate name yields a unique id');

  // 5. Validation: missing name
  throws(() => loops.create({ scope: 'project', project: 'X' }), 400, 'create without name rejected');
  // 6. Validation: global scope requires owner/name repo
  throws(() => loops.create({ name: 'g', scope: 'global' }), 400, 'global without repo rejected');
  throws(() => loops.create({ name: 'g', scope: 'global', repo: 'notarepo' }), 400, 'global with malformed repo rejected');
  // 7. Validation: bad watch / interval
  throws(() => loops.create({ name: 'w', scope: 'project', project: 'X', watch: ['nope'] }), 400, 'bad watch rejected');
  throws(() => loops.create({ name: 'i', scope: 'project', project: 'X', interval_ms: 1000 }), 400, 'sub-floor interval rejected');

  // 8. Global loop happy path
  const g = loops.create({ name: 'Public repo watch', scope: 'global', repo: 'RogerSquare/atrium', watch: ['prs', 'issues'] });
  ok(g.scope === 'global' && g.project === null && g.repo === 'RogerSquare/atrium', 'global loop stored correctly');

  // 9. Update editable fields
  const u = loops.update(a.id, { enabled: false, interval_ms: 120000, name: 'Renamed' });
  ok(u.enabled === false && u.interval_ms === 120000 && u.name === 'Renamed', 'update applies editable fields');
  ok(u.id === a.id && u.created_at === a.created_at, 'update preserves id + created_at');
  ok(u.updated_at !== a.updated_at, 'update bumps updated_at');

  // 10. Update ignores engine-managed fields
  const u2 = loops.update(a.id, { status: 'running', last_result: 'hax', id: 'evil' });
  ok(u2.status === 'idle' && u2.last_result === null && u2.id === a.id, 'engine-managed/immutable fields not client-writable');

  // 11. Update validation (partial): bad interval
  throws(() => loops.update(a.id, { interval_ms: 5 }), 400, 'update with sub-floor interval rejected');
  // 12. Update missing loop -> null
  ok(loops.update('loop-does-not-exist', { enabled: true }) === null, 'update of missing loop returns null');

  // 13. Switching scope to global enforces repo requirement
  throws(() => loops.update(a.id, { scope: 'global' }), 400, 'switching to global without repo rejected');

  // 14. patchRuntime (engine helper) writes runtime fields
  const r = loops.patchRuntime(a.id, { status: 'running', last_run_at: 'now' });
  ok(r.status === 'running' && r.last_run_at === 'now', 'patchRuntime writes runtime fields');

  // 15. Delete
  ok(loops.remove(a.id) === true, 'remove existing returns true');
  ok(loops.remove(a.id) === false, 'remove missing returns false');
  ok(loops.get(a.id) === null, 'deleted loop no longer retrievable');

  console.log(`\nAll ${passed} loop-model assertions passed.`);
} finally {
  cleanup();
}
