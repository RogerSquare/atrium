// Playwright runner: the original scripts/run-e2e.js behavior, extracted
// (feat-runners-core-001). Runs `npx playwright test` with the JSON+HTML
// reporters, summarizes the JSON report into the e2e_run schema, and lists
// the artifact directories to upload. The summarize logic is pure and moved
// here VERBATIM in behavior — Atrium's own suite is the regression proof.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Playwright JSON report → e2e_run summary (minus run_id, stamped by the
// caller after upload). `baseDir` is what attachment paths are relativized
// against — previously the hardcoded FRONTEND_DIR.
function summarize(report, baseDir) {
  const specs = [];
  const walk = (suite, fileFromAncestor) => {
    const file = suite.file || fileFromAncestor;
    for (const spec of suite.specs || []) {
      const test = spec.tests?.[0];
      const result = test?.results?.[test.results.length - 1];
      const attachments = (result?.attachments || []).map((a) => ({
        name: a.name,
        contentType: a.contentType,
        path: a.path ? path.relative(baseDir, a.path).replace(/\\/g, '/') : null,
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

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

// Run Playwright in `cwd`. Returns { summary, artifactDirs, exitCode } or
// { error, exitCode } when no JSON report was produced (config error, crash
// before any test ran).
function runPlaywright({ cwd, filter }, deps = {}) {
  const spawnImpl = deps.spawnSync || spawnSync;
  const jsonReportPath = path.join(cwd, 'playwright-report.json');
  const testResultsDir = path.join(cwd, 'test-results');
  const htmlReportDir = path.join(cwd, 'playwright-report');

  // Clean previous artifacts so what we capture matches this run only.
  rmrf(testResultsDir);
  rmrf(htmlReportDir);
  rmrf(jsonReportPath);

  const args = ['playwright', 'test', '--reporter=line,json,html'];
  if (filter) args.push('--grep', filter);

  const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: jsonReportPath, PLAYWRIGHT_HTML_REPORT: htmlReportDir };
  const result = spawnImpl('npx', args, { cwd, env, stdio: 'inherit', shell: true });

  if (!fs.existsSync(jsonReportPath)) {
    return { error: 'Playwright did not write a JSON report.', exitCode: result.status ?? 1 };
  }
  const report = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
  return {
    summary: summarize(report, cwd),
    artifactDirs: [
      { abs: testResultsDir, prefix: 'test-results' },
      { abs: htmlReportDir, prefix: 'playwright-report' },
    ],
    exitCode: result.status ?? 0,
  };
}

module.exports = { summarize, runPlaywright };
