// MCP tool for the generalized test runners (feat-runners-core-001).
// Supersedes atrium_run_e2e (kept as an alias in run_e2e.js): any suite from
// the project's atrium.tests.json can run — Playwright, a JUnit-emitting
// command (swift test, gradle, dotnet, pytest), or a bare exit-code command —
// all normalized into the same e2e_run schema + artifact store.

const path = require('path');
const { spawn } = require('child_process');

const SCRIPT_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'run-e2e.js');

function buildArgs({ task, project, suite, filter }) {
  const args = [SCRIPT_PATH, '--task', task];
  if (project) args.push('--project', project);
  if (suite) args.push('--suite', suite);
  if (filter) args.push('--filter', filter);
  return args;
}

async function runViaScript(input) {
  if (!input.task) throw new Error('task is required');
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, buildArgs(input), { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      const summaryLine = stdout.split('\n').reverse().find((l) => l.includes('[run-tests]') || l.includes('[run-e2e]'));
      resolve({
        exit_code: code,
        summary: summaryLine || null,
        stdout: stdout.slice(-2000),
        stderr: stderr.slice(-2000),
      });
    });
  });
}

const inputSchema = {
  type: 'object',
  properties: {
    task: { type: 'string', description: 'Task ID this run belongs to (e.g. feat-sidebar-task-count-001).' },
    project: { type: 'string', description: 'Optional project name whose atrium.tests.json declares the suites. Defaults to the task\'s own project, then to Atrium\'s built-in Playwright suite.' },
    suite: { type: 'string', description: 'Optional suite id from atrium.tests.json. Defaults to the first declared suite.' },
    filter: { type: 'string', description: 'Optional --grep pattern (Playwright suites only).' },
  },
  required: ['task'],
};

module.exports = {
  name: 'atrium_run_tests',
  description: 'Run a test suite for a task — Playwright, a JUnit-XML-emitting command (swift test, gradle, dotnet, pytest), or an exit-code command, per the project\'s atrium.tests.json — upload artifacts, and write back e2e_run + e2e_status + e2e_suite. Without a config file this runs the built-in Playwright suite exactly like atrium_run_e2e always did.',
  inputSchema,
  handler: runViaScript,
  // Shared with run_e2e.js so the alias cannot drift.
  _impl: { runViaScript, inputSchema },
};
