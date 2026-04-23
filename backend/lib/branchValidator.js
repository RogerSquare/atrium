// Validates that a task transitioning into `review` has the linkage fields
// needed by the Changes view to connect it to its PR/branch.
// Pure function; no I/O. See opt-review-branch-validation-001 for context.
// TDD-driven; tests live at backend/lib/branchValidator.test.js.

module.exports = { validateReviewLinkage };

function validateReviewLinkage(task, previousStatus) {
  const branch = typeof task.github_branch === 'string' && task.github_branch.trim() ? task.github_branch : null;
  const prUrl = typeof task.github_pr_url === 'string' && task.github_pr_url.trim() ? task.github_pr_url : null;
  if (!branch && !prUrl) {
    return {
      error: `github_branch or github_pr_url required when transitioning task to review.`,
      detail: `Set github_branch (must contain task ID '${task.id}' as a case-insensitive substring) OR github_pr_url. Example branch: 'feat/${task.id}'. To skip this check for a non-code task, add the 'no-code' tag before transitioning.`,
      task_id: task.id,
      received: { github_branch: task.github_branch || null, github_pr_url: task.github_pr_url || null },
    };
  }
  if (branch && !prUrl && !branch.toLowerCase().includes(task.id.toLowerCase())) {
    return {
      error: `github_branch '${branch}' does not contain task ID '${task.id}' as a case-insensitive substring.`,
      detail: `Rename the branch to include the task ID (e.g., 'feat/${task.id}', 'fix/${task.id}', 'opt/${task.id}') so the Changes view can link the PR to the task. Alternatively, set github_pr_url directly.`,
      task_id: task.id,
      received: { github_branch: branch },
    };
  }
  return null;
}
