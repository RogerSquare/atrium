const { apiGet } = require('../api');

module.exports = {
  name: 'atrium_get_task',
  description: 'Fetch a single Atrium task with full detail — content, activity_log, tags, depends_on, files_affected. Call this before starting work to load the task into context.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The task ID (e.g. "feat-terminal-claude-cli-001").' },
    },
    required: ['id'],
  },
  handler: async ({ id }) => {
    if (!id) throw new Error('id is required');
    return await apiGet(`/api/tasks/${encodeURIComponent(id)}`);
  },
};
