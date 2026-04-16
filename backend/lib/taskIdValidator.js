// Canonical task-id convention — see CLAUDE.md "Task ID (STRICT)".
//
// Format: {category}-{descriptor}-{NNN}
//   - category: fixed set from CLAUDE.md
//   - descriptor: one or more lowercase hyphen-separated segments
//   - NNN: exactly 3 digits
//
// Examples:
//   valid:    feat-auth-001, bug-dnd-001, feat-project-archive-impl-007
//   invalid:  task-1763290321, Feat-Auth-001, feat-auth-1, feature-auth-001
const TASK_ID_REGEX = /^(feat|bug|ui|opt|comp|devops|mobile)(-[a-z0-9]+)+-\d{3}$/;

const EXAMPLES = ['feat-auth-001', 'bug-dnd-001', 'ui-filters-003', 'opt-perf-004'];

function isValidTaskId(id) {
  return typeof id === 'string' && TASK_ID_REGEX.test(id);
}

// Returns an error payload matching the canonical 400 response shape, or null if valid.
function validateTaskId(id, { fieldName = 'id' } = {}) {
  if (!id || typeof id !== 'string' || !id.trim()) {
    return {
      error: `${fieldName} is required`,
      expected_format: 'category-descriptor-NNN (lowercase, hyphens only, 3-digit number)',
      examples: EXAMPLES,
    };
  }
  if (!TASK_ID_REGEX.test(id)) {
    return {
      error: `${fieldName} does not match the required format`,
      received: id,
      expected_format: 'category-descriptor-NNN (lowercase, hyphens only, 3-digit number). Category must be one of: feat, bug, ui, opt, comp, devops, mobile.',
      examples: EXAMPLES,
    };
  }
  return null;
}

module.exports = { TASK_ID_REGEX, EXAMPLES, isValidTaskId, validateTaskId };
