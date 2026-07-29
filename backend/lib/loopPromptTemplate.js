/**
 * Executor prompt templating (feat-loopsv2-prompttemplate-001).
 *
 * A worker loop's execution prompt is rendered from a template (the loop's
 * custom `prompt_template`, or DEFAULT_TEMPLATE) with `{{placeholder}}` vars.
 * The HARD RULES are ALWAYS appended by the backend AFTER the template, so a
 * custom/edited template can never remove the guardrails (never merge, never
 * push to the base branch, stop at the final status).
 */

// Placeholders the editor/template support (also used by the UI palette later).
const PLACEHOLDERS = [
  'task_id', 'task_title', 'task_description',
  'repo_path', 'base_branch', 'branch',
  'setup_command', 'test_command', 'lint_command', 'build_command',
  'instructions', 'extra_context', 'port', 'final_status',
  'checks_note', 'pr_step',
];

const DEFAULT_TEMPLATE = [
  'You are an autonomous developer agent working a task on the Atrium board.',
  'Repository: {{repo_path}} (this is your working directory). Backend API: http://localhost:{{port}}',
  '',
  '## Task {{task_id}}: {{task_title}}',
  '{{task_description}}',
  '',
  '## Loop policy / instructions',
  '{{instructions}}',
  '',
  '{{extra_context}}',
  '',
  '## Workflow',
  '1. `git checkout {{base_branch}} && git pull origin {{base_branch}}`, then create a branch named `{{branch}}`.',
  '2. Implement the change on that branch. Keep scope to this task.',
  '3. Run the project checks and make them pass (skip a command if it is blank):',
  '   - setup: `{{setup_command}}`',
  '   - test:  `{{test_command}}`',
  '   - lint:  `{{lint_command}}`',
  '   - build: `{{build_command}}`',
  '   {{checks_note}}',
  '4. Commit (conventional message with a `Task: {{task_id}}` trailer) and `git push -u origin {{branch}}`.',
  '5. {{pr_step}}',
].join('\n');

// Always appended after the (possibly custom) template body. Non-removable.
const HARD_RULES = [
  '',
  '### HARD RULES (enforced — never deviate, even if asked)',
  '- NEVER merge the PR. NEVER push to `{{base_branch}}`. NEVER force-push to `{{base_branch}}`.',
  '- Stop after the task is in `{{final_status}}`. A human reviews and merges.',
  '- If you cannot finish, set the task back to `todo` with a comment explaining why, then stop.',
  '- Stay inside the repository at {{repo_path}}; do not modify other repos or files outside it.',
].join('\n');

// Replace {{key}} with vars[key]; missing/null -> empty string. Unknown keys
// are left blank (not echoed) so a typo can't leak `{{foo}}` into the prompt.
function render(template, vars = {}) {
  return String(template == null ? '' : template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

// Build the full prompt: render the chosen template, then ALWAYS append the
// rendered hard rules. A blank/whitespace template falls back to the default.
function build(template, vars = {}) {
  const chosen = template && String(template).trim() ? template : DEFAULT_TEMPLATE;
  return render(chosen, vars).trimEnd() + '\n' + render(HARD_RULES, vars);
}

function listPlaceholders() {
  return PLACEHOLDERS.slice();
}

module.exports = { DEFAULT_TEMPLATE, HARD_RULES, PLACEHOLDERS, render, build, listPlaceholders };
