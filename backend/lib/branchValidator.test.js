// TDD tests for backend/lib/branchValidator.js
// Written cycle-by-cycle (see git log on feat/opt-review-branch-validation-001-implement).
// Third smoke test of the Atrium TDD skill after slugify + taskWaiters.

const test = require('node:test');
const assert = require('node:assert');

// Cycle 2: branch set but doesn't contain task id → Case 2 error.
test('review + branch without task id → Case 2 error', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = {
    id: 'feat-x-001',
    status: 'review',
    github_branch: 'feat/unrelated',
    github_pr_url: null,
    tags: [],
  };
  const result = validateReviewLinkage(task, 'todo');
  assert.ok(result, 'should return an error object');
  assert.match(result.error, /does not contain task ID/i);
  assert.deepStrictEqual(result.received, { github_branch: 'feat/unrelated' });
});

// Cycle 3: valid branch containing task id → null (passes).
test('review + branch with task id → null', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', github_branch: 'feat/feat-x-001', github_pr_url: null, tags: [] };
  assert.strictEqual(validateReviewLinkage(task, 'todo'), null);
});

// Cycle 4: grandfather — task already in review, subsequent edit → null (no validation).
test('previousStatus=review → null (grandfathered)', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', github_branch: null, github_pr_url: null, tags: [] };
  assert.strictEqual(validateReviewLinkage(task, 'review'), null);
});

// Cycle 5: no-code tag opt-out → null.
test('tags includes no-code → null (opt-out)', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', github_branch: null, github_pr_url: null, tags: ['no-code'] };
  assert.strictEqual(validateReviewLinkage(task, 'todo'), null);
});

// Cycle 6: github_pr_url alone (no branch) → null.
test('pr_url only, no branch → null (Pass-1 override)', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', github_branch: null, github_pr_url: 'https://github.com/x/y/pull/1', tags: [] };
  assert.strictEqual(validateReviewLinkage(task, 'todo'), null);
});

// Cycle 7: grandfather for previousStatus=done.
test('previousStatus=done → null (grandfathered)', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', github_branch: null, github_pr_url: null, tags: [] };
  assert.strictEqual(validateReviewLinkage(task, 'done'), null);
});

// Cycle 8: not transitioning to review — should never fire regardless of linkage.
test('status=in_progress → null (not transitioning to review)', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = { id: 'feat-x-001', status: 'in_progress', github_branch: null, github_pr_url: null, tags: [] };
  assert.strictEqual(validateReviewLinkage(task, 'todo'), null);
});

// Cycle 9: case-insensitive substring match.
test('branch contains task id in different case → null', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', github_branch: 'FEAT/FEAT-X-001', github_pr_url: null, tags: [] };
  assert.strictEqual(validateReviewLinkage(task, 'todo'), null);
});

// Cycle 10: tags undefined is treated as empty array (legacy task shape).
test('tags undefined → treated as [] (no crash)', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = { id: 'feat-x-001', status: 'review', github_branch: 'feat/feat-x-001', github_pr_url: null /* tags absent */ };
  assert.strictEqual(validateReviewLinkage(task, 'todo'), null);
});

function requireFresh() {
  const p = require.resolve('./branchValidator');
  delete require.cache[p];
  return require('./branchValidator');
}

// Cycle 1: transitioning to review with no branch and no pr_url returns Case 1 error.
test('review + no linkage fields → Case 1 error', () => {
  const { validateReviewLinkage } = requireFresh();
  const task = {
    id: 'feat-x-001',
    status: 'review',
    github_branch: null,
    github_pr_url: null,
    tags: [],
  };
  const result = validateReviewLinkage(task, 'todo');
  assert.ok(result, 'should return an error object');
  assert.match(result.error, /required.*review/i);
  assert.ok(result.detail.includes('feat-x-001'), 'detail should mention task id');
  assert.deepStrictEqual(result.received, { github_branch: null, github_pr_url: null });
});
