const { PORT } = require('./constants');

// Map<taskId, { process, startedAt, startedBy, promptFile }>
const activeAgents = new Map();

const buildAgentPrompt = (task, instructions) => {
  const lines = [];
  lines.push(`You are working on task ${task.id}: "${task.title}".`);
  lines.push('');
  lines.push('## Task Details');
  lines.push(`- **ID**: ${task.id}`);
  lines.push(`- **Status**: ${task.status}`);
  lines.push(`- **Priority**: ${task.priority}`);
  lines.push(`- **Type**: ${task.type || 'fullstack'}`);
  if (task.component) lines.push(`- **Component**: ${task.component}`);
  if (task.tags && task.tags.length) lines.push(`- **Tags**: ${task.tags.join(', ')}`);
  if (task.parent_task) lines.push(`- **Parent Task**: ${task.parent_task}`);
  if (task.files_affected && task.files_affected.length) {
    lines.push(`- **Files Affected**: ${task.files_affected.join(', ')}`);
  }
  lines.push('');
  if (task.content) {
    lines.push('## Task Description & Comments');
    lines.push(task.content);
    lines.push('');
  }
  lines.push('## Instructions');
  lines.push(instructions);
  lines.push('');
  lines.push('## Important Reminders');
  lines.push(`- Update the task via the API when done: PUT http://localhost:${PORT}/api/tasks/${task.id}`);
  lines.push('- Set status to "review" when finished (NOT "done" or "completed")');
  lines.push('- Add a comment under ### Comments following the commenting rules in the instructions');
  return lines.join('\n');
};

module.exports = { activeAgents, buildAgentPrompt };
