// Generalized test-runner orchestration (feat-runners-core-001).
//
// scripts/run-e2e.js was Playwright-only and hardcoded Atrium's own frontend
// dir. This keeps its OUTPUT contract byte-compatible — the e2e_run summary
// schema, the artifact upload to /api/e2e-runs/:task, the {e2e_run,
// e2e_status} PUT — while making the runner pluggable per suite:
//
//   suite.report = 'playwright-json'  → runners/playwright.js
//   suite.report = 'junit-xml'        → runners/junitCmd.js + JUnit parser
//   suite.report = 'exit-code'        → runners/junitCmd.js, exit code only
//
// Suites come from the project's atrium.tests.json (see testsConfig.js).
// No config ⇒ DEFAULT_SUITE, which is exactly the old behavior — Atrium's
// own Playwright suite is the regression proof.
//
// Provenance (accepted default Q5): the run stays self-reported, but every
// summary is stamped with `source` (which parser produced it) and `suite`
// (which suite id ran), and the task gets `e2e_suite` alongside e2e_status.

const fs = require('fs');
const path = require('path');
const { parseTestsConfig, resolveProjectDir } = require('./testsConfig');
const { runPlaywright } = require('./playwright');
const { runCommand, parseJunitXml, exitCodeSummary } = require('./junitCmd');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');
const CONFIG_FILENAME = 'atrium.tests.json';

// The pre-refactor behavior as a suite definition.
const DEFAULT_SUITE = {
  id: 'playwright-e2e',
  label: 'Playwright e2e (frontend)',
  runner: 'playwright',
  report: 'playwright-json',
  cwd: path.join(REPO_ROOT, 'frontend'),
  command: null,
  reportPath: null,
  artifacts: [],
  target: { kind: 'local' },
};

// --- pure helpers ---------------------------------------------------------

// passing / failing / skipped from a normalized summary — same rule the old
// script used, verbatim.
function deriveStatus(summary) {
  if (summary.total === 0) return 'skipped';
  return summary.failed === 0 ? 'passing' : 'failing';
}

// Minimal glob → RegExp for artifact collection: `**` crosses directories,
// `*` stays within one segment. Enough for "junit.xml", "reports/**/*.xml".
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // "**/" also matches zero directories
      } else {
        out += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      out += `\\${c}`;
    } else if (c === '/') {
      out += '/';
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

function pickSuite(suites, suiteId) {
  if (!suiteId) return { suite: suites[0] };
  const suite = suites.find((s) => s.id === suiteId);
  if (!suite) {
    return { error: `Unknown suite "${suiteId}". Available: ${suites.map((s) => s.id).join(', ')}` };
  }
  return { suite };
}

// --- fs walking / artifact collection (I/O, injectable) -------------------

function walkFiles(rootAbs, prefix = '') {
  const out = [];
  if (!fs.existsSync(rootAbs)) return out;
  for (const entry of fs.readdirSync(rootAbs, { withFileTypes: true })) {
    const abs = path.join(rootAbs, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel));
    else if (entry.isFile()) out.push({ abs, rel });
  }
  return out;
}

// Collect a command suite's artifacts: the report file itself plus any
// configured globs, all relative to the suite cwd.
function collectArtifacts({ cwd, reportPath, globs }) {
  const all = walkFiles(cwd);
  const wanted = new Map();
  if (reportPath) {
    const rel = reportPath.replace(/\\/g, '/');
    const hit = all.find((f) => f.rel === rel);
    if (hit) wanted.set(hit.rel, hit);
  }
  const regexes = (globs || []).map(globToRegExp);
  if (regexes.length > 0) {
    for (const f of all) {
      if (wanted.has(f.rel)) continue;
      if (regexes.some((re) => re.test(f.rel))) wanted.set(f.rel, f);
    }
  }
  return [...wanted.values()];
}

// --- API I/O (same endpoints as the old script) ---------------------------

function apiContext(env = process.env) {
  return {
    url: env.ATRIUM_URL || 'http://localhost:3001',
    token: env.ATRIUM_API_TOKEN,
  };
}

async function uploadArtifacts({ api, taskId, files, log }) {
  if (files.length === 0) {
    log(`[run-tests] No artifact files found to upload.`);
    return null;
  }
  const form = new FormData();
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    form.append(f.rel, new Blob([buf]), path.basename(f.rel));
  }
  const res = await fetch(`${api.url}/api/e2e-runs/${encodeURIComponent(taskId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${api.token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Artifact upload failed: HTTP ${res.status} — ${await res.text()}`);
  return res.json();
}

async function patchTask({ api, taskId, fields }) {
  const res = await fetch(`${api.url}/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.token}` },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`Task PUT failed: HTTP ${res.status} — ${await res.text()}`);
  return res.json();
}

async function fetchTaskProject({ api, taskId }) {
  const res = await fetch(`${api.url}/api/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${api.token}` },
  });
  if (!res.ok) return null;
  const task = await res.json();
  return task && typeof task.project === 'string' ? task.project : null;
}

// --- suite resolution -----------------------------------------------------

// Where do we look for atrium.tests.json?
//   1. explicit projectDir
//   2. <workingDirectory>/<project> (from settings.json + the project arg or
//      the task's own project field)
//   3. Atrium's own repo root
// Absent config anywhere ⇒ DEFAULT_SUITE (old behavior, zero migration).
async function resolveSuites({ api, taskId, project, projectDir, log }) {
  let dir = projectDir || null;
  if (!dir) {
    let projectName = project || null;
    if (!projectName && api.token) {
      projectName = await fetchTaskProject({ api, taskId }).catch(() => null);
    }
    if (projectName && projectName !== 'Root') {
      let workingDirectory = null;
      try {
        workingDirectory = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).workingDirectory || null;
      } catch { /* settings.json absent — fall through to repo root */ }
      dir = resolveProjectDir(workingDirectory, projectName, fs);
      if (!dir) log(`[run-tests] Project "${projectName}" has no folder under the working directory — falling back to Atrium's own suite.`);
    }
  }
  if (!dir) dir = REPO_ROOT;

  const configPath = path.join(dir, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return { suites: [DEFAULT_SUITE], configPath: null, baseDir: dir };
  }
  const { suites } = parseTestsConfig(fs.readFileSync(configPath, 'utf8'));
  // Suite cwd entries are relative to the config's directory.
  const absolute = suites.map((s) => ({ ...s, cwd: path.resolve(dir, s.cwd) }));
  return { suites: absolute, configPath, baseDir: dir };
}

// --- main entry -----------------------------------------------------------

// Run one suite for a task: execute → normalize → upload artifacts → write
// e2e_run/e2e_status/e2e_suite back to the task. Returns the final summary.
async function runTests({ task, project, projectDir, suite: suiteId, filter, env = process.env, log = console.error }) {
  if (!task) throw new Error('task is required');
  const api = apiContext(env);
  if (!api.token) throw new Error('ATRIUM_API_TOKEN env var is required.');

  const { suites, configPath } = await resolveSuites({ api, taskId: task, project, projectDir, log });
  const { suite, error: pickError } = pickSuite(suites, suiteId);
  if (pickError) throw new Error(pickError);

  if (suite.target.kind !== 'local') {
    throw new Error(
      `Suite "${suite.id}" targets "${suite.target.kind}:${suite.target.ref}" — only "local" is executable today. ` +
      `Container targets arrive with devops-runner-proxy-jobs-001 / feat-runner-swift-spm-001; ssh targets with feat-runner-xcuitest-ssh-001.`
    );
  }
  log(`[run-tests] task=${task} suite=${suite.id} (${configPath || 'built-in default'})`);

  const startedAt = new Date().toISOString();
  let summary;
  let files;
  let exitCode;

  if (suite.report === 'playwright-json') {
    const result = runPlaywright({ cwd: suite.cwd, filter });
    if (result.error) {
      log(`[run-tests] ${result.error} Aborting upload.`);
      const err = new Error(result.error);
      err.exitCode = result.exitCode;
      throw err;
    }
    summary = result.summary;
    exitCode = result.exitCode;
    files = result.artifactDirs.flatMap((d) => walkFiles(d.abs, d.prefix));
  } else {
    const run = await runCommand({ command: suite.command, cwd: suite.cwd, env: {} });
    exitCode = run.exitCode;
    if (suite.report === 'junit-xml') {
      const reportAbs = path.resolve(suite.cwd, suite.reportPath);
      if (!fs.existsSync(reportAbs)) {
        throw new Error(`Suite "${suite.id}" exited ${run.exitCode} without writing its JUnit report at ${suite.reportPath}.\n${run.output.slice(-2000)}`);
      }
      const parsed = parseJunitXml(fs.readFileSync(reportAbs, 'utf8'));
      summary = { started_at: startedAt, flaky: 0, ...parsed };
    } else {
      summary = { started_at: startedAt, flaky: 0, ...exitCodeSummary({ command: suite.command, exitCode: run.exitCode, durationMs: run.durationMs, output: run.output }) };
    }
    files = collectArtifacts({ cwd: suite.cwd, reportPath: suite.reportPath, globs: suite.artifacts });
  }

  const upload = await uploadArtifacts({ api, taskId: task, files, log });
  const runId = upload?.run_id || new Date().toISOString().replace(/[:.]/g, '-');

  const finalSummary = {
    run_id: runId,
    ...summary,
    // Provenance stamps (Q5): who parsed this and which suite it was.
    source: suite.report,
    suite: suite.id,
  };
  const e2eStatus = deriveStatus(finalSummary);

  await patchTask({ api, taskId: task, fields: { e2e_run: finalSummary, e2e_status: e2eStatus, e2e_suite: suite.id } });

  log(`\n[run-tests] task=${task} suite=${suite.id} run_id=${runId} status=${e2eStatus} ${finalSummary.passed}/${finalSummary.total} passed in ${finalSummary.duration_ms}ms`);
  return { summary: finalSummary, e2e_status: e2eStatus, exit_code: exitCode };
}

// --- CLI (what scripts/run-e2e.js now delegates to) -----------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task') out.task = argv[++i];
    else if (argv[i] === '--filter') out.filter = argv[++i];
    else if (argv[i] === '--suite') out.suite = argv[++i];
    else if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--project-dir') out.projectDir = argv[++i];
  }
  return out;
}

async function cli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.task) {
    console.error('Usage: node backend/scripts/run-e2e.js --task <task-id> [--suite <id>] [--project <name>] [--project-dir <path>] [--filter <grep>]');
    process.exit(2);
  }
  try {
    const { exit_code } = await runTests({ ...args, log: (m) => console.log(m) });
    process.exit(exit_code ?? 0);
  } catch (err) {
    console.error('[run-tests] Fatal:', err.message);
    process.exit(err.exitCode ?? 1);
  }
}

module.exports = {
  DEFAULT_SUITE,
  deriveStatus,
  globToRegExp,
  pickSuite,
  collectArtifacts,
  resolveSuites,
  runTests,
  parseArgs,
  cli,
};
