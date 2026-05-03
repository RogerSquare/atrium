// MCP tool wrapping backend/scripts/run-e2e.js so agents can invoke the
// Playwright run + upload + summary loop without leaving their session.
// See feat-e2e-tests-tab-001-implement, Phase 3.

const path = require('path');
const { spawn } = require('child_process');

const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'run-e2e.js');

module.exports = {
  name: 'atrium_run_e2e',
  description: 'Run Playwright e2e tests for a task, upload artifacts (videos, traces, HTML report), and write back the summary + e2e_status. Pass `task` (required) and optional `filter` to grep specs. Returns the run summary.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task ID this run belongs to (e.g. feat-sidebar-task-count-001).' },
      filter: { type: 'string', description: 'Optional --grep pattern to limit which specs run.' },
    },
    required: ['task'],
  },
  handler: async ({ task, filter }) => {
    if (!task) throw new Error('task is required');
    const args = [SCRIPT_PATH, '--task', task];
    if (filter) args.push('--filter', filter);
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        const summaryLine = stdout.split('\n').reverse().find((l) => l.includes('[run-e2e]'));
        resolve({
          exit_code: code,
          summary: summaryLine || null,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-2000),
        });
      });
    });
  },
};
