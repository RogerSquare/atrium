const fs = require('fs');
const path = require('path');
const os = require('os');
const pty = require('node-pty');
const { LOOP_RUNS_DIR } = require('./constants');
const { logger } = require('./logger');
const { getIO } = require('./io');
const { resolveClaudeBin } = require('./claudeBin');

/**
 * Live PTY runner for loop agent runs (feat-loopsv2-terminal-001).
 *
 * Spawns an agent in a real PTY (node-pty, same tech as the web-shell), streams
 * its output live over socket.io (`loopterm:output` / `loopterm:exit`, keyed by
 * runId), and persists the full session to a `.log` file so a finished run can
 * be replayed in the Terminal tab. The autonomous executor (later phase) reuses
 * `start()` with a different prompt + a repo-scoped cwd.
 */

const RUN_HARD_TIMEOUT_MS = 15 * 60 * 1000; // 15 min safety kill
const active = new Map(); // runId -> { pty, loopId, startedAt, exited, code, timer }

function dir(loopId) {
  return path.join(LOOP_RUNS_DIR, String(loopId).replace(/[^a-zA-Z0-9_-]/g, '_'));
}
function logPath(loopId, runId) { return path.join(dir(loopId), `${runId}.log`); }
function metaPath(loopId, runId) { return path.join(dir(loopId), `${runId}.termrun.json`); }

function emit(event, payload) {
  try { const io = getIO(); if (io) io.emit(event, payload); } catch { /* io not ready */ }
}

function writeMeta(meta) {
  try {
    const d = dir(meta.loop_id);
    fs.mkdirSync(d, { recursive: true });
    const p = metaPath(meta.loop_id, meta.run_id);
    fs.writeFileSync(p + '.tmp', JSON.stringify(meta, null, 2));
    fs.renameSync(p + '.tmp', p);
  } catch (err) { logger.warn({ err: err.message }, 'loopPty: failed to write run meta'); }
}

/**
 * Start a PTY agent run. `prompt` is passed to `claude -p` as a single arg
 * (node-pty spawns without a shell, so no quoting issues). Returns the runId.
 */
function start(loop, { prompt, label = 'agent run', cwd = os.tmpdir(), allowTools = false, onExit = null } = {}) {
  const runId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { bin } = resolveClaudeBin();
  const d = dir(loop.id);
  fs.mkdirSync(d, { recursive: true });
  const logStream = fs.createWriteStream(logPath(loop.id, runId), { flags: 'a' });

  const meta = {
    run_id: runId, loop_id: loop.id, kind: 'terminal', label,
    status: 'running', exit_code: null,
    started_at: new Date().toISOString(), finished_at: null,
  };
  writeMeta(meta);

  let child;
  try {
    // allowTools=true (executor) lets the agent edit files / run git+gh — it runs
    // in the project's repo cwd. Summaries (allowTools=false) stay sandboxed.
    const args = allowTools ? ['-p', '--dangerously-skip-permissions', prompt] : ['-p', prompt];
    child = pty.spawn(bin, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
  } catch (err) {
    logStream.write(`\r\n[failed to spawn agent: ${err.message}]\r\n`);
    logStream.end();
    meta.status = 'error'; meta.finished_at = new Date().toISOString();
    writeMeta(meta);
    emit('loopterm:exit', { runId, loopId: loop.id, code: -1, status: 'error' });
    return runId;
  }

  const entry = { pty: child, loopId: loop.id, startedAt: Date.now(), exited: false, code: null, timer: null };
  active.set(runId, entry);
  try { require('./loopActivity').append(loop.id, { type: 'terminal_run', message: `Started terminal run: ${label}`, refs: { run_id: runId } }); } catch { /* ignore */ }

  entry.timer = setTimeout(() => { try { child.kill(); } catch {} }, RUN_HARD_TIMEOUT_MS);

  child.onData((data) => {
    try { logStream.write(data); } catch { /* stream closed */ }
    emit('loopterm:output', { runId, loopId: loop.id, data });
  });

  child.onExit(({ exitCode }) => {
    clearTimeout(entry.timer);
    entry.exited = true; entry.code = exitCode;
    try { logStream.end(); } catch {}
    meta.status = exitCode === 0 ? 'done' : 'error';
    meta.exit_code = exitCode;
    meta.finished_at = new Date().toISOString();
    writeMeta(meta);
    try { require('./loopActivity').append(loop.id, { type: 'terminal_run', message: `Terminal run ${meta.status} (exit ${exitCode}): ${label}`, refs: { run_id: runId } }); } catch { /* ignore */ }
    emit('loopterm:exit', { runId, loopId: loop.id, code: exitCode, status: meta.status });
    try { if (typeof onExit === 'function') onExit({ code: exitCode, status: meta.status, runId }); } catch (e) { logger.warn({ err: e.message }, 'loopPty onExit cb'); }
    // keep the entry briefly for late attach, then drop
    setTimeout(() => active.delete(runId), 60 * 1000);
  });

  return runId;
}

function listRuns(loopId) {
  const d = dir(loopId);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((f) => f.endsWith('.termrun.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

function getLog(loopId, runId) {
  const p = logPath(loopId, runId);
  if (!fs.existsSync(p)) return null;
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

function isRunning(runId) {
  const e = active.get(runId);
  return !!(e && !e.exited);
}

// Startup sweep (feat-hub-rethink-impl-001): a backend restart kills PTY
// children but leaves their metas 'running' forever. Called from
// loopManager.init() BEFORE any new run starts, so everything still marked
// 'running' on disk is by definition dead. `rootDir` injectable for tests.
function sweepInterrupted(rootDir = LOOP_RUNS_DIR) {
  const swept = [];
  let loopDirs = [];
  try { loopDirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return swept; }
  for (const d of loopDirs) {
    const dp = path.join(rootDir, d.name);
    let files = [];
    try { files = fs.readdirSync(dp).filter((f) => f.endsWith('.termrun.json')); } catch { continue; }
    for (const f of files) {
      const p = path.join(dp, f);
      try {
        const meta = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (meta.status !== 'running') continue;
        meta.status = 'interrupted';
        meta.finished_at = new Date().toISOString();
        fs.writeFileSync(p + '.tmp', JSON.stringify(meta, null, 2));
        fs.renameSync(p + '.tmp', p);
        swept.push({ loop_id: meta.loop_id, run_id: meta.run_id, label: meta.label });
      } catch { /* unreadable meta — leave it */ }
    }
  }
  return swept;
}

function kill(runId) {
  const e = active.get(runId);
  if (e && !e.exited) { try { e.pty.kill(); } catch {} return true; }
  return false;
}

module.exports = { start, listRuns, getLog, isRunning, kill, sweepInterrupted };
