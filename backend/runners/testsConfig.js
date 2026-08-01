// Per-project test-suite registry (feat-runners-core-001).
//
// A project opts into the generalized runners by dropping `atrium.tests.json`
// at its repo root:
//
//   {
//     "suites": [
//       { "id": "unit", "label": "Swift unit tests",
//         "runner": "command", "cwd": ".", "command": "swift test",
//         "report": "junit-xml", "reportPath": "junit.xml",
//         "artifacts": ["junit.xml", ".build/**/*.log"],
//         "target": "local" }
//     ]
//   }
//
// Everything here is pure — parsing, validation, target parsing, and project
// directory resolution take their inputs (and fs) as arguments so the whole
// matrix is unit-testable without touching disk.

const REPORT_KINDS = ['playwright-json', 'junit-xml', 'exit-code'];
const RUNNER_KINDS = ['playwright', 'command'];

// target: 'local' | 'container:<image>' | 'ssh:<host>'.
// Only `local` is executable today — container needs the socket-proxy job
// capability (devops-runner-proxy-jobs-001), ssh needs a reachable Mac
// (feat-runner-xcuitest-ssh-001). The SHAPE is validated now so configs
// written for those runners don't silently rot.
function parseTarget(raw) {
  if (raw == null || raw === '' || raw === 'local') return { kind: 'local' };
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(container|ssh):(.+)$/);
  if (!m) return null;
  return { kind: m[1], ref: m[2] };
}

// Validate one suite entry. Returns { suite, errors: [] } with defaults
// applied — callers collect errors across the file for one readable message.
function normalizeSuite(raw, index) {
  const errors = [];
  const at = `suites[${index}]`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { suite: null, errors: [`${at}: must be an object`] };
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) errors.push(`${at}: "id" is required`);
  else if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) errors.push(`${at}: "id" may contain only letters, digits and hyphens`);

  const runner = raw.runner === undefined ? (raw.report === 'playwright-json' ? 'playwright' : 'command') : raw.runner;
  if (!RUNNER_KINDS.includes(runner)) errors.push(`${at}: "runner" must be one of: ${RUNNER_KINDS.join(', ')}`);

  const report = raw.report === undefined ? (runner === 'playwright' ? 'playwright-json' : 'exit-code') : raw.report;
  if (!REPORT_KINDS.includes(report)) errors.push(`${at}: "report" must be one of: ${REPORT_KINDS.join(', ')}`);
  if (runner === 'playwright' && report !== 'playwright-json') {
    errors.push(`${at}: runner "playwright" implies report "playwright-json"`);
  }

  if (runner === 'command' && (typeof raw.command !== 'string' || !raw.command.trim())) {
    errors.push(`${at}: "command" is required for runner "command"`);
  }
  if (report === 'junit-xml' && (typeof raw.reportPath !== 'string' || !raw.reportPath.trim())) {
    errors.push(`${at}: "reportPath" (where the JUnit XML lands, relative to cwd) is required for report "junit-xml"`);
  }

  const target = parseTarget(raw.target);
  if (!target) errors.push(`${at}: "target" must be "local", "container:<image>" or "ssh:<host>"`);
  if (target && target.kind === 'container' && report === 'playwright-json') {
    errors.push(`${at}: container targets support junit-xml / exit-code reports, not playwright-json`);
  }

  const artifacts = raw.artifacts === undefined ? [] : raw.artifacts;
  if (!Array.isArray(artifacts) || artifacts.some((g) => typeof g !== 'string' || !g.trim())) {
    errors.push(`${at}: "artifacts" must be an array of glob strings`);
  }

  if (errors.length > 0) return { suite: null, errors };
  return {
    suite: {
      id,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : id,
      runner,
      report,
      cwd: typeof raw.cwd === 'string' && raw.cwd.trim() ? raw.cwd.trim() : '.',
      command: typeof raw.command === 'string' ? raw.command.trim() : null,
      reportPath: typeof raw.reportPath === 'string' ? raw.reportPath.trim() : null,
      artifacts,
      target,
    },
    errors: [],
  };
}

// Parse a whole atrium.tests.json (text or already-parsed object).
// Returns { suites } or throws with EVERY problem listed — a config author
// should see the full damage in one pass, not one error per run.
function parseTestsConfig(input) {
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch (e) {
      throw new Error(`atrium.tests.json is not valid JSON: ${e.message}`);
    }
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.suites)) {
    throw new Error('atrium.tests.json must be an object with a "suites" array');
  }
  const errors = [];
  const suites = [];
  const seen = new Set();
  obj.suites.forEach((raw, i) => {
    const { suite, errors: es } = normalizeSuite(raw, i);
    errors.push(...es);
    // Duplicate detection tracks RAW ids so a duplicate is flagged even when
    // one of the twins has other validation errors.
    const rawId = raw && typeof raw.id === 'string' ? raw.id.trim() : '';
    if (rawId) {
      if (seen.has(rawId)) errors.push(`suites[${i}]: duplicate id "${rawId}"`);
      seen.add(rawId);
    }
    if (suite) suites.push(suite);
  });
  if (suites.length === 0 && errors.length === 0) errors.push('"suites" is empty');
  if (errors.length > 0) throw new Error(`Invalid atrium.tests.json:\n- ${errors.join('\n- ')}`);
  return { suites };
}

// Best-effort mapping from an Atrium project name to its repo directory under
// the operator's workingDirectory. Layouts observed in the wild: exact name,
// then case-insensitive / space-insensitive folder matches ("Cairn" → cairn/).
// `fsImpl` is injected (existsSync, readdirSync) so the logic is testable.
function resolveProjectDir(workingDirectory, projectName, fsImpl) {
  if (!workingDirectory || !projectName) return null;
  const pathJoin = (a, b) => `${a.replace(/[\\/]+$/, '')}${a.includes('\\') ? '\\' : '/'}${b}`;
  const direct = pathJoin(workingDirectory, projectName);
  if (fsImpl.existsSync(direct)) return direct;
  let entries;
  try {
    entries = fsImpl.readdirSync(workingDirectory);
  } catch {
    return null;
  }
  const want = projectName.toLowerCase().replace(/[\s_-]+/g, '');
  const hit = entries.find((e) => e.toLowerCase().replace(/[\s_-]+/g, '') === want);
  return hit ? pathJoin(workingDirectory, hit) : null;
}

module.exports = {
  REPORT_KINDS,
  RUNNER_KINDS,
  parseTarget,
  normalizeSuite,
  parseTestsConfig,
  resolveProjectDir,
};
