const { apiGet, apiPost } = require('../api');

const listTemplates = {
  name: 'atrium_list_templates',
  description: 'List available Atrium task templates (e.g. phase-research, phase-plan, phase-implement, bug-fix, ui-component). Each template carries default type, priority, tags, and a starter content body.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    const data = await apiGet('/api/tasks/templates');
    return data?.templates || [];
  },
};

const fromTemplate = {
  name: 'atrium_from_template',
  description: 'Create a new task from a template. Template id is e.g. "phase-research", "phase-plan", "phase-implement", "bug-fix". Pass overrides (title, project, etc.) to fill in task-specific fields. Status defaults to "draft" for human promotion.',
  inputSchema: {
    type: 'object',
    properties: {
      template_id: { type: 'string', description: 'The template filename without .json (e.g. "phase-research").' },
      overrides: {
        type: 'object',
        description: 'Fields to override from the template (title, project, id, priority, content, etc.).',
        properties: {
          title: { type: 'string' },
          project: { type: 'string' },
          id: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          content: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'todo'] },
          depends_on: { type: 'array', items: { type: 'string' } },
          parent_task: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: true,
      },
    },
    required: ['template_id'],
  },
  handler: async ({ template_id, overrides = {} }) => {
    if (!template_id) throw new Error('template_id is required');
    // Ensure new tasks default to draft unless caller explicitly picks todo.
    const body = { status: 'draft', ...overrides };
    return await apiPost(`/api/tasks/from-template/${encodeURIComponent(template_id)}`, body);
  },
};

module.exports = [listTemplates, fromTemplate];
