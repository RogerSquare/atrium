const { apiGet, apiPut } = require('../api');

// Fetch-modify-write helper so callers can add a comment without regenerating the whole body.
// Appends under the "### Comments" section. If that section is absent, adds one.

module.exports = {
  name: 'atrium_append_comment',
  description: 'Append a comment to the "### Comments" section of an Atrium task. Use this to log progress, findings, or decisions without rewriting the whole description. Preferred over atrium_update_task when you only need to add text.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      comment: { type: 'string', description: 'Markdown comment. Prepend with a bullet ("- ") for readability if not already formatted.' },
    },
    required: ['id', 'comment'],
  },
  handler: async ({ id, comment }) => {
    if (!id) throw new Error('id is required');
    if (!comment || typeof comment !== 'string') throw new Error('comment is required');
    const task = await apiGet(`/api/tasks/${encodeURIComponent(id)}`);
    const content = task?.content || task?.task?.content || '';
    const hasComments = /### Comments/.test(content);
    const addition = comment.trimEnd() + '\n';
    const newContent = hasComments
      ? content.replace(/### Comments\s*\n?/, (m) => `${m}\n${addition}`)
      : `${content.trimEnd()}\n\n### Comments\n\n${addition}`;
    return await apiPut(`/api/tasks/${encodeURIComponent(id)}`, { content: newContent });
  },
};
