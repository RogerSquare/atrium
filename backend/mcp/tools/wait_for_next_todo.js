const { apiGet } = require('../api');

module.exports = {
  name: 'atrium_wait_for_next_todo',
  description: 'Long-poll for the next task promoted to `todo` (or newly created in `todo` status) that matches the filter. Blocks for up to `timeout_seconds`. On match, the task is ATOMICALLY CLAIMED — its status becomes `in_progress` and assignee becomes the caller before the tool returns. On timeout returns { task: null, timeout: true } — call again to keep watching. Use for worker-loop flows: call this tool, receive a task, emit "Picked up <id>: <title>", execute the work, call again.',
  inputSchema: {
    type: 'object',
    properties: {
      assignee: {
        type: 'string',
        description: 'Agent name to filter by, e.g. "agent:claude-opus-4-7". A task with NO assignee also matches (so the tool picks up unassigned work).',
      },
      project: {
        type: 'string',
        description: 'Optional project folder to filter by (e.g. "Atrium", "Cairn"). Omit to match any project.',
      },
      timeout_seconds: {
        type: 'number',
        description: 'Max seconds to wait. Default 270 (~4.5min). Server hard-caps at ATRIUM_WAIT_MAX_SECONDS (default 300). If timeout elapses with no match, returns { task: null, timeout: true }; re-call to keep watching.',
      },
    },
    required: ['assignee'],
  },
  handler: async ({ assignee, project, timeout_seconds = 270 }) => {
    const params = new URLSearchParams({ assignee, timeout_seconds: String(timeout_seconds) });
    if (project) params.set('project', project);
    return await apiGet(`/api/tasks/wait-for-next-todo?${params}`);
  },
};
