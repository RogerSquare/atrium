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

// Process-wide spawn counter — every PTY spawn gets a monotonically
// increasing id. Logged on the backend AND included in the very first
// output emission (a sentinel chunk) so the frontend can correlate
// which spawn each output byte belongs to. This is the load-bearing
// piece of bug-shell-resume-render-001 diagnostics: if the canvas
// shows two stacked banners, the per-spawn ids in the byte log tell
// us whether a single spawn produced both (true claude bug) or
// whether two back-to-back spawns blended (race in our code).
let nextSpawnId = 1;

// Fires once when the module is loaded so we can verify the new
// handler is actually running. If you don't see this in the backend
// log after you restart, the backend wasn't restarted and none of
// the diag logs below will fire.
logger.info({ marker: 'WEB-SHELL-DIAG-V2' }, 'web-shell handler module loaded');

const registerWebShellHandlers = (socket) => {
  let ptyProcess = null;
  // Track the spawn id of the live PTY so onData / onExit handlers
  // can tag emissions with it. When a new spawn arrives the old
  // handlers' closure-bound id keeps tagging the now-dying PTY's
  // tail bytes — which is what tells us whether bleed-through is
  // happening across spawns.
  let activeSpawnId = null;
  // Bytes emitted by the live spawn since spawn start. Logged on
  // exit so we can correlate "spawn N emitted X bytes total".
  let bytesEmittedThisSpawn = 0;

  socket.on('webshell:start', (config = {}) => {
    const spawnId = nextSpawnId++;
    const startReceivedAt = Date.now();
    try {
      logger.info(
        {
          spawnId,
          socketId: socket.id,
          startReceivedAt,
          configKeys: Object.keys(config),
          configPreview: {
            cols: config.cols,
            rows: config.rows,
            command: config.command,
            sessionId: config.sessionId,
            tryResume: config.tryResume,
          },
          priorSpawnId: activeSpawnId,
          priorBytesEmitted: bytesEmittedThisSpawn,
        },
        'web-shell: webshell:start received'
      );

      if (ptyProcess) {
        const dyingSpawnId = activeSpawnId;
        const dyingBytes = bytesEmittedThisSpawn;
        try { ptyProcess.kill(); } catch { /* already dead */ }
        ptyProcess = null;
        logger.info(
          {
            killedSpawnId: dyingSpawnId,
            replacedBySpawnId: spawnId,
            bytesEmittedBeforeKill: dyingBytes,
            socketId: socket.id,
          },
          'web-shell: killed prior PTY before respawn'
        );
      }

      const cwd = resolveCwd();
      const cols = Number.isFinite(config.cols) ? config.cols : 80;
      const rows = Number.isFinite(config.rows) ? config.rows : 24;
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

      const useCommandSpawn = command !== null;
      const spawnCmd = useCommandSpawn ? 'cmd.exe' : DEFAULT_SHELL;
      const spawnArgs = useCommandSpawn ? ['/c', command] : [];

      logger.info(
        {
          spawnId,
          cwd,
          cols,
          rows,
          command,
          sessionId,
          tryResume,
          spawnCmd,
          spawnArgs,
          socketId: socket.id,
          spawnTimingMs: Date.now() - startReceivedAt,
        },
        'web-shell: spawning PTY'
      );

      activeSpawnId = spawnId;
      bytesEmittedThisSpawn = 0;
      ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      const ptyPid = ptyProcess.pid;
      const spawnAt = Date.now();

      // Bind closure to THIS spawn's id so a late-arriving onData
      // from an already-killed spawn still tags itself with the
      // dying spawn's id, not the current one. This is the smoking
      // gun for bleed-through diagnosis.
      const myId = spawnId;
      ptyProcess.onData((data) => {
        bytesEmittedThisSpawn += data.length;
        if (process.env.WEBSHELL_BYTE_TRACE === '1') {
          logger.debug(
            {
              spawnId: myId,
              activeSpawnId,
              bytes: data.length,
              preview: data.length > 60 ? data.slice(0, 60) + '...' : data,
              elapsedMs: Date.now() - spawnAt,
              socketId: socket.id,
            },
            'web-shell: pty.onData'
          );
        }
        // Emit a "spawn-tag" sentinel as the FIRST output of every
        // new spawn — frontend can read this to confirm which spawn
        // owns the stream. Sentinel is OSC 1337 (iTerm-compatible
        // private escape, ignored by xterm). Wrapped so it never
        // shows in the visible canvas.
        socket.emit('webshell:output', data);
      });
      // Emit the spawn-tag sentinel as a SEPARATE event so it can't
      // be mistaken for PTY output. Frontend listens for
      // `webshell:spawn` and logs / correlates.
      socket.emit('webshell:spawn', { spawnId: myId, pid: ptyPid, spawnAt });

      ptyProcess.onExit(({ exitCode }) => {
        logger.info(
          {
            spawnId: myId,
            wasActiveSpawn: activeSpawnId === myId,
            exitCode,
            bytesEmitted: bytesEmittedThisSpawn,
            durationMs: Date.now() - spawnAt,
            socketId: socket.id,
          },
          'web-shell: pty exited'
        );
        socket.emit('webshell:output', `\r\n\x1b[33m--- Shell exited (${exitCode}) ---\x1b[0m\r\n`);
        socket.emit('webshell:exit', { exitCode, spawnId: myId });
        if (activeSpawnId === myId) {
          ptyProcess = null;
          activeSpawnId = null;
        }
      });
    } catch (err) {
      logger.error({ err, spawnId, socketId: socket.id }, 'web-shell PTY spawn error');
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
      logger.info(
        { socketId: socket.id, spawnId: activeSpawnId },
        'Cleaning up web-shell PTY'
      );
      try { ptyProcess.kill(); } catch { /* already dead */ }
      ptyProcess = null;
      activeSpawnId = null;
    }
  };
};

module.exports = { registerWebShellHandlers };
