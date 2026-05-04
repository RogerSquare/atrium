#!/usr/bin/env node
// Wrapper that runs Playwright, captures the JSON report + artifact files,
// uploads them to /api/e2e-runs/<task_id>, and writes back the summary +
// e2e_status to the task. See feat-e2e-tests-tab-001-implement, Phase 3.
//
// Usage:
//   ATRIUM_API_TOKEN=<jwt> node backend/scripts/run-e2e.js --task <task-id> [--filter <grep>]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ATRIUM_URL = process.env.ATRIUM_URL || 'http://localhost:3001';
const ATRIUM_API_TOKEN = process.env.ATRIUM_API_TOKEN;

const args = parseArgs(process.argv.slice(2));
if (!args.task) {
  console.error('Usage: node backend/scripts/run-e2e.js --task <task-id> [--filter <grep>]');
  process.exit(2);
}
if (!ATRIUM_API_TOKEN) {
  console.error('ATRIUM_API_TOKEN env var is required.');
  process.exit(2);
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
const JSON_REPORT_PATH = path.join(FRONTEND_DIR, 'playwright-report.json');
const TEST_RESULTS_DIR = path.join(FRONTEND_DIR, 'test-results');
const HTML_REPORT_DIR = path.join(FRONTEND_DIR, 'playwright-report');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task') out.task = argv[++i];
    else if (argv[i] === '--filter') out.filter = argv[++i];
  }
  return out;
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

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

function summarize(report, runId) {
  const specs = [];
  const walk = (suite, fileFromAncestor) => {
    const file = suite.file || fileFromAncestor;
    for (const spec of suite.specs || []) {
      const test = spec.tests?.[0];
      const result = test?.results?.[test.results.length - 1];
      const attachments = (result?.attachments || []).map((a) => ({
        name: a.name,
        contentType: a.contentType,
        path: a.path ? path.relative(FRONTEND_DIR, a.path).replace(/\\/g, '/') : null,
      }));
      specs.push({
        file: spec.file || file || '',
        title: spec.title,
        status: result?.status || 'unknown',
        duration_ms: result?.duration ?? 0,
        error: result?.errors?.[0]?.message || null,
        attachments,
      });
    }
    for (const child of suite.suites || []) walk(child, file);
  };
  for (const top of report.suites || []) walk(top, null);

  const stats = report.stats || {};
  return {
    run_id: runId,
    started_at: stats.startTime || new Date().toISOString(),
    duration_ms: stats.duration ?? 0,
    total: specs.length,
    passed: stats.expected ?? specs.filter((s) => s.status === 'passed').length,
    failed: stats.unexpected ?? specs.filter((s) => s.status === 'failed').length,
    skipped: stats.skipped ?? specs.filter((s) => s.status === 'skipped').length,
    flaky: stats.flaky ?? 0,
    specs,
  };
}

async function uploadArtifacts(taskId) {
  const files = [
    ...walkFiles(TEST_RESULTS_DIR, 'test-results'),
    ...walkFiles(HTML_REPORT_DIR, 'playwright-report'),
  ];
  if (files.length === 0) {
    console.warn('[run-e2e] No artifact files found to upload.');
    return null;
  }
  const form = new FormData();
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    form.append(f.rel, new Blob([buf]), path.basename(f.rel));
  }
  const res = await fetch(`${ATRIUM_URL}/api/e2e-runs/${encodeURIComponent(taskId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ATRIUM_API_TOKEN}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Artifact upload failed: HTTP ${res.status} — ${text}`);
  }
  return res.json();
}

async function patchTask(taskId, fields) {
  const res = await fetch(`${ATRIUM_URL}/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ATRIUM_API_TOKEN}` },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Task PUT failed: HTTP ${res.status} — ${text}`);
  }
  return res.json();
}

(async () => {
  // Clean previous artifacts so what we capture matches this run only.
  rmrf(TEST_RESULTS_DIR);
  rmrf(HTML_REPORT_DIR);
  rmrf(JSON_REPORT_PATH);

  const playwrightArgs = ['playwright', 'test', '--reporter=line,json,html'];
  if (args.filter) playwrightArgs.push('--grep', args.filter);

  const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: JSON_REPORT_PATH, PLAYWRIGHT_HTML_REPORT: HTML_REPORT_DIR };
  const result = spawnSync('npx', playwrightArgs, { cwd: FRONTEND_DIR, env, stdio: 'inherit', shell: true });

  if (!fs.existsSync(JSON_REPORT_PATH)) {
    console.error('[run-e2e] Playwright did not write a JSON report. Aborting upload.');
    process.exit(result.status ?? 1);
  }
  const report = JSON.parse(fs.readFileSync(JSON_REPORT_PATH, 'utf8'));

  const upload = await uploadArtifacts(args.task);
  const runId = upload?.run_id || new Date().toISOString().replace(/[:.]/g, '-');
  const summary = summarize(report, runId);
  const e2eStatus = summary.failed === 0 && summary.total > 0 ? 'passing' : (summary.total === 0 ? 'skipped' : 'failing');

  await patchTask(args.task, { e2e_run: summary, e2e_status: e2eStatus });

  console.log(`\n[run-e2e] task=${args.task} run_id=${runId} status=${e2eStatus} ${summary.passed}/${summary.total} passed in ${summary.duration_ms}ms`);
  process.exit(result.status ?? 0);
})().catch((err) => {
  console.error('[run-e2e] Fatal:', err.message);
  process.exit(1);
});
