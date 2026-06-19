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
function start(loop, { prompt, label = 'agent run', cwd = os.tmpdir() } = {}) {
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
    child = pty.spawn(bin, ['-p', prompt], {
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
    emit('loopterm:exit', { runId, loopId: loop.id, code: exitCode, status: meta.status });
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

function kill(runId) {
  const e = active.get(runId);
  if (e && !e.exited) { try { e.pty.kill(); } catch {} return true; }
  return false;
}

module.exports = { start, listRuns, getLog, isRunning, kill };
