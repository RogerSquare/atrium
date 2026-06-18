#!/usr/bin/env node
/**
 * Tests for the loop engine's pure change-detection logic (feat-loops-engine-001).
 * Run with `node scripts/test-loop-engine.js` (or `npm run test:loop-engine`).
 * The scheduling/tick path needs a live repo + gh and is verified manually
 * (see the task notes); this suite locks the diff/event semantics offline.
 */
const { detectChanges, normalizeEntry, describeEvents, HIGH_SIGNAL } = require('../lib/loopManager');

let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1); }
  passed++;
}
const types = (r) => r.events.map((e) => e.type);
const ALL = ['prs', 'ci', 'commits', 'issues'];

// normalizeEntry
const n = normalizeEntry({ pr_number: 5, pr_url: 'u', pr_state: 'OPEN', review_decision: '', ci_status: 'SUCCESS', branch: 'b', branch_sha: 'abc', extra: 'drop' });
ok(n.pr_number === 5 && n.pr_state === 'OPEN' && n.branch_sha === 'abc' && n.extra === undefined, 'normalizeEntry keeps tracked fields only');
ok(normalizeEntry(null) === null, 'normalizeEntry(null) -> null');

// Baseline: prev null -> no events
ok(detectChanges(null, n, ALL).baseline === true, 'prev null is a baseline pass');
ok(detectChanges(null, n, ALL).events.length === 0, 'baseline emits no events');

// No change -> no events
ok(detectChanges(n, { ...n }, ALL).events.length === 0, 'identical snapshots -> no events');

// PR opened (null -> OPEN)
const prevNoPr = normalizeEntry({ pr_state: null });
ok(types(detectChanges(prevNoPr, normalizeEntry({ pr_state: 'OPEN' }), ALL)).includes('pr_opened'), 'null->OPEN yields pr_opened');

// PR merged / closed
ok(types(detectChanges(normalizeEntry({ pr_state: 'OPEN' }), normalizeEntry({ pr_state: 'MERGED' }), ALL)).includes('pr_merged'), 'OPEN->MERGED yields pr_merged');
ok(types(detectChanges(normalizeEntry({ pr_state: 'OPEN' }), normalizeEntry({ pr_state: 'CLOSED' }), ALL)).includes('pr_closed'), 'OPEN->CLOSED yields pr_closed');

// Review decision change
ok(types(detectChanges(normalizeEntry({ pr_state: 'OPEN' }), normalizeEntry({ pr_state: 'OPEN', review_decision: 'APPROVED' }), ALL)).includes('review_changed'), 'review decision change detected');

// CI failed / recovered
ok(types(detectChanges(normalizeEntry({ ci_status: 'PENDING' }), normalizeEntry({ ci_status: 'FAILURE' }), ALL)).includes('ci_failed'), 'PENDING->FAILURE yields ci_failed');
ok(types(detectChanges(normalizeEntry({ ci_status: 'FAILURE' }), normalizeEntry({ ci_status: 'SUCCESS' }), ALL)).includes('ci_recovered'), 'FAILURE->SUCCESS yields ci_recovered');

// Commits via branch_sha delta
ok(types(detectChanges(normalizeEntry({ branch_sha: 'aaa' }), normalizeEntry({ branch_sha: 'bbb' }), ALL)).includes('commits'), 'branch_sha change yields commits');

// Watch filtering: a CI change is ignored when 'ci' isn't watched
ok(types(detectChanges(normalizeEntry({ ci_status: 'PENDING' }), normalizeEntry({ ci_status: 'FAILURE' }), ['prs'])).length === 0, 'ci change ignored when ci not watched');
// ...and a PR change is ignored when 'prs' isn't watched
ok(types(detectChanges(normalizeEntry({ pr_state: 'OPEN' }), normalizeEntry({ pr_state: 'MERGED' }), ['ci'])).length === 0, 'pr change ignored when prs not watched');

// High-signal set
ok(HIGH_SIGNAL.has('pr_opened') && HIGH_SIGNAL.has('pr_merged') && HIGH_SIGNAL.has('ci_failed'), 'high-signal set correct');
ok(!HIGH_SIGNAL.has('pr_closed') && !HIGH_SIGNAL.has('review_changed'), 'non-high-signal events excluded');

// describeEvents renders a readable line referencing the PR
const desc = describeEvents([{ type: 'pr_merged' }], normalizeEntry({ pr_number: 42 }));
ok(desc.includes('PR #42') && desc.toLowerCase().includes('merged'), 'describeEvents renders PR ref + action');

console.log(`\nAll ${passed} loop-engine assertions passed.`);
