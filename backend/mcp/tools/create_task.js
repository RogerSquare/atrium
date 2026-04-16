const { apiPost } = require('../api');
const { validateTaskId } = require('../../lib/taskIdValidator');

module.exports = {
  name: 'atrium_create_task',
  description: 'Create a new Atrium task. Defaults status to "draft" so a human promotes it to "todo" when scope is confirmed — prefer this over creating a task directly in "todo". Use `atrium_from_template` instead when you want phased task types (research/plan/implement). The `id` field is REQUIRED and must match the regex ^(feat|bug|ui|opt|comp|devops|mobile)(-[a-z0-9]+)+-\\d{3}$ — e.g. feat-auth-001, bug-dnd-001.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short, descriptive title.' },
      project: { type: 'string', description: 'Project name. Use "Root" for unassigned.', default: 'Root' },
      type: {
        type: 'string',
        enum: ['frontend', 'backend', 'fullstack', 'devops'],
        description: 'Kind of code being touched. Orthogonal to workflow phase.',
      },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        default: 'medium',
      },
      tags: { type: 'array', items: { type: 'string' }, description: 'Free-form tags. Use "phase-research" / "phase-plan" / "phase-implement" for phased work.' },
      content: { type: 'string', description: 'Markdown body. Include sections like ### Description and ### Comments.' },
      status: {
        type: 'string',
        enum: ['draft', 'todo'],
        default: 'draft',
        description: 'Agents should almost always create in "draft" and let the human promote to "todo".',
      },
      id: { type: 'string', description: 'Required. Format: category-descriptor-NNN (lowercase, 3-digit number). Category: feat|bug|ui|opt|comp|devops|mobile. Examples: feat-auth-001, bug-dnd-001.' },
      parent_task: { type: 'string', description: 'Optional parent task ID.' },
      depends_on: { type: 'array', items: { type: 'string' } },
      component: { type: 'string' },
    },
    required: ['title', 'id'],
  },
  handler: async (args) => {
    // Fail fast — same regex as the HTTP POST route, so agents don't waste a round-trip
    const idError = validateTaskId(args.id);
    if (idError) {
      throw new Error(`${idError.error}. Expected format: ${idError.expected_format}. Examples: ${idError.examples.join(', ')}.`);
    }
    const payload = {
      title: args.title,
      id: args.id,
      project: args.project || 'Root',
      type: args.type || 'fullstack',
      priority: args.priority || 'medium',
      status: args.status || 'draft',
      tags: Array.isArray(args.tags) ? args.tags : [],
      content: args.content || '### Description\n\n### Comments\n',
    };
    if (args.parent_task) payload.parent_task = args.parent_task;
    if (Array.isArray(args.depends_on)) payload.depends_on = args.depends_on;
    if (args.component) payload.component = args.component;
    return await apiPost('/api/tasks', payload);
  },
};
