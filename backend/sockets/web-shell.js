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
//   client → server   webshell:start  { cols?, rows?, command?, initialInput? }
//                     webshell:input  <bytes>
//                     webshell:resize { cols, rows }
//   server → client   webshell:output <bytes>
//                     webshell:exit   { exitCode }
//
// `command` (optional): when set, server spawns `cmd.exe /c <command>`
// directly so there's no banner/prompt before the launched CLI takes
// over the canvas. When unset, an interactive cmd.exe is spawned.
//
// `initialInput` (optional): a string written to the PTY's stdin
// ~2 seconds after spawn, wrapped in bracketed-paste markers so
// Ink-based CLIs (claude code) treat it as a single pasted message
// followed by Enter. Used by the DetailPane Shell tab to seed claude
// with the active task's context.
//
// One PTY per socket; killed on disconnect via the returned cleanup
// function.

const fs = require('fs');
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
      const command = typeof config.command === 'string' && config.command.length > 0
        ? config.command
        : null;

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
        { cwd, cols, rows, command, socketId: socket.id },
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

      // Optional initial input — write to the PTY's stdin once the
      // launched CLI has had time to settle into its input loop.
      // Wrapped in bracketed-paste markers (\x1b[200~ ... \x1b[201~)
      // so apps like claude code (Ink-based) treat it as a single
      // pasted message rather than a flurry of keystrokes; trailing
      // \r submits. Default delay 2000ms is conservative for claude's
      // startup; callers can override via `initialInputDelayMs`.
      if (typeof config.initialInput === 'string' && config.initialInput.length > 0) {
        const text = config.initialInput;
        const delayMs = Number.isFinite(config.initialInputDelayMs)
          ? config.initialInputDelayMs
          : 2000;
        setTimeout(() => {
          if (ptyProcess) {
            try {
              ptyProcess.write(`\x1b[200~${text}\x1b[201~\r`);
              logger.info(
                { socketId: socket.id, length: text.length, delayMs },
                'Wrote initialInput to web-shell PTY'
              );
            } catch (err) {
              logger.warn(
                { err, socketId: socket.id },
                'Failed to write initialInput to web-shell PTY'
              );
            }
          }
        }, delayMs);
      }
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
