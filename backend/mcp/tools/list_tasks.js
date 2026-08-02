const { apiGet } = require('../api');

// Paged since opt-tasks-pagination-001: the Atrium project alone holds 400+
// tasks and the old fetch-everything-filter-locally handler returned ~103 KB
// — past an agent's tool-result budget. Filters now ride the query string
// (the backend applies them before paginating) and the response is an
// envelope with a total, so the agent knows when to page.
module.exports = {
  name: 'atrium_list_tasks',
  description: 'List Atrium tasks, optionally filtered by status, project, or assignee. Returns { total, offset, limit, tasks } where tasks is a summarized array (one line per task) — total is the full match count, so page with offset when total > limit. Use this to find tasks to work on or to report status to the human.',
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
      limit: { type: 'number', description: 'Page size, 1-500. Default 100.' },
      offset: { type: 'number', description: 'Page start. Default 0.' },
    },
  },
  handler: async ({ status, project, assignee, limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (project) params.set('project', project);
    if (assignee) params.set('assignee', assignee);
    params.set('limit', String(Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100));
    if (Number.isFinite(offset) && offset > 0) params.set('offset', String(Math.floor(offset)));

    const data = await apiGet(`/api/tasks?${params.toString()}`);
    // With a limit param the backend always answers the paginated envelope;
    // tolerate a plain array anyway (older backend behind a newer MCP build).
    const envelope = Array.isArray(data)
      ? { total: data.length, offset: 0, limit: data.length, tasks: data }
      : { total: data?.total ?? 0, offset: data?.offset ?? 0, limit: data?.limit ?? 0, tasks: data?.tasks || [] };

    return {
      total: envelope.total,
      offset: envelope.offset,
      limit: envelope.limit,
      tasks: envelope.tasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        project: t.project,
        assignee: t.assignee,
        summary: t.summary,
      })),
    };
  },
};
