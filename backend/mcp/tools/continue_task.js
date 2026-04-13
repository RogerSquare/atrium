const { apiPost } = require('../api');

module.exports = {
  name: 'atrium_continue_task',
  description: 'Spawn the next phase task from a phase-research or phase-plan task. Reads the source task, picks the next phase (research → plan, plan → implement), and creates a new task with the source content injected and depends_on set. Only works on tasks tagged phase-research or phase-plan in status review/done.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The source task ID.' },
    },
    required: ['id'],
  },
  handler: async ({ id }) => {
    if (!id) throw new Error('id is required');
    return await apiPost(`/api/tasks/${encodeURIComponent(id)}/continue`, {});
  },
};
