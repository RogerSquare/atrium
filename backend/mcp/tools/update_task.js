const { apiPut } = require('../api');

// Whitelist of fields an agent may update. Excludes auto-managed fields (created_at,
// activity_log, summary) — those are set by the backend.
const ALLOWED_FIELDS = new Set([
  'title', 'status', 'priority', 'assignee', 'type', 'component',
  'tags', 'files_affected', 'parent_task', 'depends_on', 'due_date',
  'content', 'project',
  // Changes-view linkage fields — accepted by backend PUT /api/tasks/:id (tasks.js:726)
  // and required by the closing checklist in the Atrium skill + CLAUDE.md.
  'github_branch', 'github_pr_url',
  // Playwright e2e gate (feat-e2e-validation-001). Required on review
  // transitions unless the task carries the `no-e2e` tag.
  'e2e_status',
  // Per-task claude session UUID. MCP callers (recovery scripts re-linking a
  // task to a known-good session) can write this directly; the web-shell
  // socket also writes through this path on first spawn / rotation.
  'claude_session_id',
]);

module.exports = {
  name: 'atrium_update_task',
  description: 'Update mutable fields on an Atrium task (status, priority, assignee, tags, content, etc.). Status transitions are enforced by the backend — agents must NOT move tasks to "done" (human-only) and must NOT skip "draft → in_progress" (promote via "todo" first). Use `atrium_append_comment` if you only want to add to the Comments section without rewriting the whole content.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The task ID.' },
      fields: {
        type: 'object',
        description: 'Object of fields to update. Only whitelisted fields are accepted.',
        additionalProperties: true,
      },
    },
    required: ['id', 'fields'],
  },
  handler: async ({ id, fields }) => {
    if (!id) throw new Error('id is required');
    if (!fields || typeof fields !== 'object') throw new Error('fields object is required');
    const filtered = {};
    for (const [k, v] of Object.entries(fields)) {
      if (ALLOWED_FIELDS.has(k)) filtered[k] = v;
    }
    if (Object.keys(filtered).length === 0) {
      throw new Error(`No updatable fields provided. Allowed: ${[...ALLOWED_FIELDS].join(', ')}`);
    }
    return await apiPut(`/api/tasks/${encodeURIComponent(id)}`, filtered);
  },
};
