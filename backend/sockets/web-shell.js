// PTY-over-socket.io handler for the embedded web-shell terminal in
// the DetailPane's Shell tab.
//
// Lifted from Documents/opencode/web-shell/lib/ptyHandler.js (the
// standalone version) with two atrium-specific tweaks:
//   1. cwd resolution mirrors backend/routes/agents.js — read from
//      SETTINGS_FILE.workingDirectory, fall back to process.cwd().
//      No per-project filesystem mapping today; tasks share atrium's
//      single configured working directory.
//   2. Event names are prefixed (`webshell:*`) so we coexist with the
//      existing backend/sockets/terminal.js handler, which already
//      binds the unprefixed `start_terminal` / `terminal_input` /
//      `terminal_output` / `resize` events for its task-scoped
//      opencode flow. Both handlers run per-socket; the prefixes
//      keep their event streams from interfering.
//
// Wire format (client ↔ server):
//   client → server   webshell:start  { cols?, rows?, command? }
//                     webshell:input  <bytes>
//                     webshell:resize { cols, rows }
//   server → client   webshell:output <bytes>
//                     webshell:exit   { exitCode }
//
// `command` (optional): when set, server spawns `cmd.exe /c <command>`
// directly so there's no banner/prompt before the launched CLI takes
// over the canvas. When unset, an interactive cmd.exe is spawned.
//
// One PTY per socket; killed on disconnect via the returned cleanup
// function.

const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const { logger } = require('../lib/logger');
const { SETTINGS_FILE } = require('../lib/constants');

const DEFAULT_SHELL = process.env.WEB_SHELL_DEFAULT_SHELL || 'cmd.exe';

function resolveCwd() {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    return settings.workingDirectory || process.cwd();
  } catch {
    return process.cwd();
  }
}

// Compute the on-disk session file path claude uses for a given
// (cwd, sessionId) pair. claude stores sessions under
// ~/.claude/projects/<slug>/<uuid>.jsonl where the slug is the
// absolute cwd with every path separator AND `:` replaced by `-`.
// So `C:\Users\RogerSquare\Documents\opencode` becomes the slug
// `C--Users-RogerSquare-Documents-opencode`. Resolved relative to
// the user's home dir.
function claudeSlugForCwd(cwd) {
  return cwd.replace(/[\\/:]/g, '-');
}
function claudeSessionFile(cwd, sessionId) {
  return path.join(os.homedir(), '.claude', 'projects', claudeSlugForCwd(cwd), `${sessionId}.jsonl`);
}

// Pick the right claude command line for the requested session:
//   - tryResume=true   → if the session file exists on disk, use
//                        `claude --resume <uuid>` (revives the
//                        conversation); else fall back to
//                        `claude --session-id <uuid>` so the spawn
//                        doesn't error with "No conversation found".
//   - tryResume=false  → always `claude --session-id <uuid>`
//                        (used by Start New Session after rotating).
// The decision is logged so the user can correlate Shell-tab
// behavior with what the backend actually spawned.
function buildClaudeCommand(cwd, sessionId, tryResume, socketId) {
  if (!sessionId) return 'claude';
  const sessionFile = claudeSessionFile(cwd, sessionId);
  let exists = false;
  try { exists = fs.existsSync(sessionFile); } catch { exists = false; }
  const useResume = tryResume && exists;
  const command = useResume
    ? `claude --resume ${sessionId}`
    : `claude --session-id ${sessionId}`;
  // Structured log to diagnose per-task session recovery — this is
  // the trail to look at when "Resume" doesn't behave as expected.
  logger.info(
    {
      socketId,
      cwd,
      sessionId,
      tryResume,
      sessionFile,
      sessionFileExists: exists,
      decision: useResume ? '--resume' : '--session-id',
      command,
    },
    'web-shell: resolved claude command for session'
  );
  return command;
}

const registerWebShellHandlers = (socket) => {
  let ptyProcess = null;

  socket.on('webshell:start', (config = {}) => {
    try {
      if (ptyProcess) {
        try { ptyProcess.kill(); } catch { /* already dead */ }
        ptyProcess = null;
      }

      const cwd = resolveCwd();
      const cols = Number.isFinite(config.cols) ? config.cols : 80;
      const rows = Number.isFinite(config.rows) ? config.rows : 24;
      // Backwards-compat: clients that send a raw `command` still
      // get exactly that command spawned (no decision logic). Newer
      // clients pass `sessionId` (+ optional `tryResume`) and let the
      // server resolve the right `claude --session-id` /
      // `claude --resume` flag based on whether the session file is
      // actually on disk — fixes the "No conversation found" loop
      // when Resume targeted a never-saved session.
      const sessionId = typeof config.sessionId === 'string' && config.sessionId.length > 0
        ? config.sessionId
        : null;
      const tryResume = !!config.tryResume;
      let command = typeof config.command === 'string' && config.command.length > 0
        ? config.command
        : null;
      if (!command && sessionId) {
        command = buildClaudeCommand(cwd, sessionId, tryResume, socket.id);
      }

      // Branch on whether a startup command is requested.
      //   command set    → `cmd.exe /c <command>`. /c is silent (no
      //                    banner, no prompt), runs the command, exits
      //                    when it finishes. The CLI is the only PTY
      //                    emitter from the first byte.
      //   command absent → interactive shell, normal bare-shell flow.
      const useCommandSpawn = command !== null;
      const spawnCmd = useCommandSpawn ? 'cmd.exe' : DEFAULT_SHELL;
      const spawnArgs = useCommandSpawn ? ['/c', command] : [];

      logger.info(
        {
          cwd,
          cols,
          rows,
          command,
          sessionId,
          tryResume,
          spawnCmd,
          spawnArgs,
          socketId: socket.id,
        },
        'Starting web-shell PTY session'
      );

      // TERM=xterm-256color unlocks 256-color escapes for tools that
      // check $TERM. COLORTERM=truecolor unlocks 24-bit color. Without
      // both, claude's gradient ASCII art renders flat (16-color mode).
      ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });

      ptyProcess.onData((data) => socket.emit('webshell:output', data));
      ptyProcess.onExit(({ exitCode }) => {
        socket.emit('webshell:output', `\r\n\x1b[33m--- Shell exited (${exitCode}) ---\x1b[0m\r\n`);
        socket.emit('webshell:exit', { exitCode });
        ptyProcess = null;
      });
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'web-shell PTY spawn error');
      socket.emit(
        'webshell:output',
        `\r\n\x1b[31mError starting terminal: ${err.message}\x1b[0m\r\n`
      );
    }
  });

  socket.on('webshell:input', (data) => {
    if (ptyProcess) ptyProcess.write(data);
  });

  socket.on('webshell:resize', (size) => {
    if (!ptyProcess || !size) return;
    try {
      ptyProcess.resize(size.cols, size.rows);
    } catch {
      // resize on a dead pty throws — safe to ignore
    }
  });

  return () => {
    if (ptyProcess) {
      logger.info({ socketId: socket.id }, 'Cleaning up web-shell PTY');
      try { ptyProcess.kill(); } catch { /* already dead */ }
      ptyProcess = null;
    }
  };
};

module.exports = { registerWebShellHandlers };
