#!/usr/bin/env node
/**
 * Tests for the loop AI-summary agent's pure context/prompt builders
 * (feat-loops-hook-agent-001). The spawn path (claude -p) is integration-only;
 * this locks the context capture + prompt shape that get reviewed.
 * Run: node scripts/test-loop-agent.js  (or npm run test:loop-agent)
 */
const { buildContext, buildPrompt } = require('../lib/loopAgent');

let passed = 0;
function ok(cond, msg) { if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1); } passed++; }

const loop = { id: 'loop-x', name: 'X watcher', project: 'Cairn' };
const task = { id: 'feat-cairn-001', title: 'Do the thing', status: 'in_progress' };
const prChanges = {
  pr_url: 'https://github.com/RogerSquare/cairn/pull/7', pr_title: 'Add thing',
  base_branch: 'main', head_branch: 'feat/feat-cairn-001', additions: 40, deletions: 3, changed_files: 2,
  commits: [{ abbreviated_oid: 'abc1234', message_headline: 'add thing', author: { login: 'rs' } }],
  files: [{ path: 'src/a.js', additions: 30, deletions: 1 }, { path: 'src/b.js', additions: 10, deletions: 2 }],
};
const link = { pr_state: 'OPEN', ci_status: 'SUCCESS', review_decision: 'REVIEW_REQUIRED', pr_url: prChanges.pr_url, pr_title: prChanges.pr_title };

const ctx = buildContext(loop, { task, prNumber: 7, prChanges, event: 'pr_opened', link });
ok(ctx.event === 'pr_opened', 'event carried');
ok(ctx.loop.id === 'loop-x' && ctx.loop.project === 'Cairn', 'loop info carried');
ok(ctx.task.id === 'feat-cairn-001' && ctx.task.status === 'in_progress', 'task info carried');
ok(ctx.pr.number === 7 && ctx.pr.url.endsWith('/pull/7'), 'pr number+url carried');
ok(ctx.pr.state === 'OPEN' && ctx.pr.ci_status === 'SUCCESS', 'pr state + ci from link');
ok(ctx.pr.additions === 40 && ctx.pr.changed_files === 2, 'diff stats from prChanges');
ok(ctx.commits.length === 1 && ctx.commits[0].sha === 'abc1234', 'commits mapped (sha)');
ok(ctx.files.length === 2 && ctx.files[0].path === 'src/a.js', 'files mapped');
ok(typeof ctx.generated_at === 'string', 'generated_at stamped');

// null task / no link is tolerated
const ctx2 = buildContext(loop, { task: null, prNumber: 9, prChanges: { commits: [], files: [] }, event: 'manual', link: null });
ok(ctx2.task === null && ctx2.pr.number === 9 && ctx2.commits.length === 0, 'handles null task/link/empty changes');

const prompt = buildPrompt(ctx);
ok(typeof prompt === 'string' && prompt.includes('pull request'), 'prompt is a string about a PR');
ok(prompt.includes('A pull request was just opened.'), 'prompt includes event reason');
ok(prompt.includes('"number": 7'), 'prompt embeds the structured context JSON');
ok(prompt.includes('under 180 words'), 'prompt constrains length');
ok(buildPrompt(ctx2).includes('A reviewer requested a summary.'), 'manual event reason');

console.log(`\nAll ${passed} loop-agent assertions passed.`);
