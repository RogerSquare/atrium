const { apiGet } = require('../api');

module.exports = {
  name: 'atrium_list_tasks',
  description: 'List Atrium tasks, optionally filtered by status, project, or assignee. Returns a summarized array (one line per task) so the list stays readable for Claude. Use this to find tasks to work on or to report status to the human.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['draft', 'todo', 'in_progress', 'waiting_input', 'review', 'done'],
        description: 'Filter by status. Omit to include all.',
      },
      project: { type: 'string', description: 'Filter by project name (e.g. "Atrium", "Cairn").' },
      assignee: { type: 'string', description: 'Filter by assignee username.' },
    },
  },
  handler: async ({ status, project, assignee } = {}) => {
    const data = await apiGet('/api/tasks');
    const all = Array.isArray(data) ? data : (data?.tasks || []);
    let filtered = all;
    if (status) filtered = filtered.filter(t => t.status === status);
    if (project) filtered = filtered.filter(t => t.project === project);
    if (assignee) filtered = filtered.filter(t => t.assignee === assignee);
    return filtered.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      project: t.project,
      assignee: t.assignee,
      summary: t.summary,
    }));
  },
};
