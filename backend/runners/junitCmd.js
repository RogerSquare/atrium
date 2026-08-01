// Command runner: run an arbitrary test command and read its result either
// from a JUnit XML report (the lingua franca every ecosystem can emit —
// swift-tools, gradle, dotnet, pytest, ctest) or from the exit code alone
// (feat-runners-core-001).
//
// The XML parser is deliberately dependency-free. JUnit XML is a small,
// stable dialect: <testsuites>/<testsuite>/<testcase> with optional
// <failure>/<error>/<skipped> children. A full XML parser would be a new
// dependency for a grammar this fixed.

const { spawn } = require('child_process');

// --- tiny XML helpers (pure) ---------------------------------------------

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
function decodeEntities(s) {
  // &amp; last, or "&amp;lt;" would double-decode.
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(lt|gt|quot|apos);/g, (m) => ENTITIES[m])
    .replace(/&amp;/g, '&');
}

function parseAttrs(tagText) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(tagText)) !== null) {
    attrs[m[1] || m[3]] = decodeEntities(m[2] !== undefined ? m[2] : m[4]);
  }
  return attrs;
}

// Strip CDATA wrappers but keep their contents; drop comments.
function cleanBody(s) {
  return String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner);
}

// --- JUnit XML → normalized specs (pure) ---------------------------------

// Returns { total, passed, failed, skipped, duration_ms, specs } where each
// spec is the SAME shape scripts/run-e2e.js has always written into e2e_run:
// { file, title, status, duration_ms, error, attachments: [] }.
function parseJunitXml(xmlText) {
  if (typeof xmlText !== 'string' || !xmlText.trim()) {
    throw new Error('JUnit report is empty');
  }
  const xml = cleanBody(xmlText);
  if (!/<testsuite[\s>]/.test(xml) && !/<testsuites[\s>/]/.test(xml)) {
    throw new Error('Not a JUnit XML report: no <testsuite> element found');
  }

  const specs = [];
  let durationMs = 0;

  // Iterate <testcase> elements — both self-closing and paired forms.
  const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = caseRe.exec(xml)) !== null) {
    const attrs = parseAttrs(m[1]);
    const body = m[3] || '';
    let status = 'passed';
    let error = null;

    const failure = body.match(/<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/);
    if (failure) {
      status = 'failed';
      const fAttrs = parseAttrs(failure[2]);
      const text = (failure[4] || '').trim();
      error = decodeEntities([fAttrs.message, text].filter(Boolean).join('\n').trim()) || 'failed';
    } else if (/<skipped\b/.test(body)) {
      status = 'skipped';
    }

    const seconds = parseFloat(attrs.time);
    const ms = Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
    durationMs += ms;

    specs.push({
      file: attrs.classname || attrs.file || '',
      title: attrs.name || '(unnamed test)',
      status,
      duration_ms: ms,
      error,
      attachments: [],
    });
  }

  if (specs.length === 0) {
    throw new Error('JUnit XML report contains no <testcase> elements');
  }

  return {
    total: specs.length,
    passed: specs.filter((s) => s.status === 'passed').length,
    failed: specs.filter((s) => s.status === 'failed').length,
    skipped: specs.filter((s) => s.status === 'skipped').length,
    duration_ms: durationMs,
    specs,
  };
}

// --- exit-code → normalized summary (pure) --------------------------------

// No report file: the command itself is the one "spec". Honest but minimal —
// the Tests tab renders it exactly like a one-test suite.
function exitCodeSummary({ command, exitCode, durationMs, output }) {
  const passed = exitCode === 0;
  return {
    total: 1,
    passed: passed ? 1 : 0,
    failed: passed ? 0 : 1,
    skipped: 0,
    duration_ms: durationMs,
    specs: [{
      file: '',
      title: command,
      status: passed ? 'passed' : 'failed',
      duration_ms: durationMs,
      error: passed ? null : `exit code ${exitCode}${output ? `\n${String(output).slice(-2000)}` : ''}`,
      attachments: [],
    }],
  };
}

// --- command execution (I/O) ---------------------------------------------

// Run the suite's command in its cwd. shell:true because commands in
// atrium.tests.json are written the way a human types them ("swift test
// --parallel"), same as services' startCmd.
function runCommand({ command, cwd, env, timeoutMs = 30 * 60 * 1000 }, deps = {}) {
  const spawnImpl = deps.spawn || spawn;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawnImpl(command, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const cap = (d) => { output = (output + d.toString()).slice(-64 * 1024); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, durationMs: Date.now() - started, output: `${output}\n${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, durationMs: Date.now() - started, output });
    });
  });
}

module.exports = { parseJunitXml, exitCodeSummary, runCommand, decodeEntities, parseAttrs };
