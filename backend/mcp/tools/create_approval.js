const { apiPost } = require('../api');

module.exports = {
  name: 'atrium_create_approval',
  description: 'Emit a mid-run approval request that pauses the task in "waiting_input" until a human responds. Use this when you hit a genuine ambiguity that would cause significant rework if guessed wrong — NOT for routine decisions the task description already makes. The task auto-transitions to "waiting_input"; after the human responds via the UI, re-fetch the task to see the chosen response and continue.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      prompt: { type: 'string', description: 'The question the human needs to answer. One sentence.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Concrete options the human can pick from. Include "cancel" when relevant.',
      },
      context: {
        type: 'object',
        description: 'Optional structured context — files, code_snippet, reasoning — to help the human decide.',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          code_snippet: { type: 'string' },
          reasoning: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
    required: ['task_id', 'prompt', 'options'],
  },
  handler: async ({ task_id, prompt, options, context }) => {
    if (!task_id) throw new Error('task_id is required');
    if (!prompt) throw new Error('prompt is required');
    if (!Array.isArray(options) || options.length === 0) throw new Error('options must be a non-empty array');
    const body = { prompt, options };
    if (context && typeof context === 'object') body.context = context;
    return await apiPost(`/api/approvals/task/${encodeURIComponent(task_id)}`, body);
  },
};
