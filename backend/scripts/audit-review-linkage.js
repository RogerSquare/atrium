#!/usr/bin/env node
// Audit: find tasks in review/done status that lack github_branch AND github_pr_url
// AND don't have the 'no-code' opt-out tag. Read-only reporter — does not touch files.
// Run via: npm run audit:linkage (from backend/)
// See opt-review-branch-validation-001 for context.

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const { TASKS_DIR } = require('../lib/constants');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function hasLinkage(data) {
  const branch = typeof data.github_branch === 'string' && data.github_branch.trim();
  const prUrl = typeof data.github_pr_url === 'string' && data.github_pr_url.trim();
  return Boolean(branch || prUrl);
}

function optedOut(data) {
  return Array.isArray(data.tags) && data.tags.includes('no-code');
}

function relativeProject(filePath) {
  return require('../lib/taskPaths').deriveProject(filePath);
}

const files = walk(TASKS_DIR);
const offenders = [];
let totalReviewDone = 0;

for (const file of files) {
  let parsed;
  try {
    parsed = matter(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // Skip unparseable files; audit-tasks covers those separately.
    continue;
  }
  const data = parsed.data || {};
  if (data.status !== 'review' && data.status !== 'done') continue;
  totalReviewDone += 1;
  if (hasLinkage(data)) continue;
  if (optedOut(data)) continue;
  offenders.push({
    id: data.id || path.basename(file, '.md'),
    status: data.status,
    project: relativeProject(file),
    tags: (data.tags || []).join('|'),
    title: (data.title || '').slice(0, 60),
  });
}

console.log(`# Review-linkage audit (${new Date().toISOString()})`);
console.log(`# Scanned: ${files.length} task files`);
console.log(`# In review or done: ${totalReviewDone}`);
console.log(`# Offenders (no github_branch, no github_pr_url, no 'no-code' tag): ${offenders.length}`);
console.log('');
console.log('id\tstatus\tproject\ttags\ttitle');
for (const row of offenders) {
  console.log(`${row.id}\t${row.status}\t${row.project}\t${row.tags}\t${row.title}`);
}
