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
const crypto = require('crypto');
const pty = require('node-pty');
const { logger } = require('../lib/logger');
const { SETTINGS_FILE } = require('../lib/constants');
const { getAllTasks, updateTaskField } = require('../lib/tasks');

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

// Resolve the claude session UUID bound to this task. Source of truth is
// the task YAML's `claude_session_id` field (feat-shell-task-resume-002).
// Behavior matrix:
//   - rotate=true            → mint fresh UUID, write back with the
//                              "rotated" activity_log entry. Caller is
//                              "Start New Session" on the exit overlay.
//   - existing field on task → return it; no write, no activity_log noise
//                              on routine spawns.
//   - field absent + clientHint provided → promote the client-supplied
//                              UUID (legacy localStorage value from
//                              feat-shell-task-resume-001 era) so the
//                              on-disk session at that UUID stays linked
//                              to this task.
//   - field absent + no hint → mint server-side. Server-side is the
//                              single source of truth (Q2 default in the
//                              task spec).
// Returns { sessionId, source } where source is one of
//   'task' | 'rotate' | 'mint' | 'migrate' — logged at info level so
// the user can correlate Shell-tab behavior with the path taken.
async function resolveTaskSessionId({ taskId, clientHint, rotate, actor }) {
  if (!taskId) return null;
  let task = null;
  try {
    task = getAllTasks().find((t) => t.id === taskId) || null;
  } catch (err) {
    logger.warn({ err, taskId }, 'web-shell: getAllTasks failed during session resolution');
  }
  if (!task) {
    logger.warn({ taskId }, 'web-shell: task not found, falling back to client hint');
    return clientHint
      ? { sessionId: clientHint, source: 'client-only' }
      : { sessionId: crypto.randomUUID(), source: 'mint-orphan' };
  }
  const existing = task.claude_session_id || null;
  if (rotate) {
    const fresh = crypto.randomUUID();
    await updateTaskField(taskId, 'claude_session_id', fresh, actor, 'Session id rotated for shell binding');
    return { sessionId: fresh, source: 'rotate' };
  }
  if (existing) {
    return { sessionId: existing, source: 'task' };
  }
  if (clientHint) {
    await updateTaskField(taskId, 'claude_session_id', clientHint, actor, 'Session id minted for shell binding (migrated from localStorage)');
    return { sessionId: clientHint, source: 'migrate' };
  }
  const fresh = crypto.randomUUID();
  await updateTaskField(taskId, 'claude_session_id', fresh, actor, 'Session id minted for shell binding');
  return { sessionId: fresh, source: 'mint' };
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

  socket.on('webshell:start', async (config = {}) => {
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
            taskId: config.taskId,
            tryResume: config.tryResume,
            rotate: config.rotate,
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
      const taskId = typeof config.taskId === 'string' && config.taskId.length > 0
        ? config.taskId
        : null;
      const clientSessionHint = typeof config.sessionId === 'string' && config.sessionId.length > 0
        ? config.sessionId
        : null;
      const rotate = !!config.rotate;
      const tryResume = !!config.tryResume;

      // When a taskId is present, the task YAML is the source of truth for
      // the bound session UUID. resolveTaskSessionId mints / promotes /
      // rotates as needed and writes back through updateTaskField so the
      // activity_log records the change exactly once. When no taskId is
      // sent (legacy callers, or non-task contexts), we fall back to the
      // client-supplied sessionId verbatim — same shape as before this
      // task shipped.
      let sessionId = clientSessionHint;
      let sessionSource = 'client';
      if (taskId) {
        try {
          const resolved = await resolveTaskSessionId({
            taskId,
            clientHint: clientSessionHint,
            rotate,
            actor: 'web-shell',
          });
          if (resolved && resolved.sessionId) {
            sessionId = resolved.sessionId;
            sessionSource = resolved.source;
          }
        } catch (err) {
          logger.error({ err, taskId, socketId: socket.id }, 'web-shell: session resolution failed; falling back to client hint');
        }
      }
      logger.info(
        {
          spawnId,
          taskId,
          sessionId,
          sessionSource,
          rotate,
          tryResume,
          socketId: socket.id,
        },
        'web-shell: resolved session binding'
      );

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

      // Bind closure to THIS spawn's id. node-pty queues onExit on
      // the next tick; if the user clicks Resume before that tick
      // runs, we'll have already killed-and-respawned by the time
      // the queued onExit fires. Without the activeSpawnId guard
      // below, that late onExit emits "--- Shell exited ---" output
      // + an exit event AFTER the new banner started rendering on
      // the freshly-reset client canvas — exactly the corruption
      // pattern from bug-shell-resume-render-001. Same guard for
      // late onData bytes from the dying spawn.
      const myId = spawnId;
      ptyProcess.onData((data) => {
        if (activeSpawnId !== myId) {
          if (process.env.WEBSHELL_BYTE_TRACE === '1') {
            logger.debug(
              {
                spawnId: myId,
                activeSpawnId,
                bytes: data.length,
                socketId: socket.id,
              },
              'web-shell: dropped onData from non-active spawn'
            );
          }
          return;
        }
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
        socket.emit('webshell:output', data);
      });
      // Include resolved sessionId on the spawn sentinel so the frontend
      // can mirror it into localStorage (cache + offline-fallback) and
      // surface it in the exit-recovery overlay's session-id chip.
      socket.emit('webshell:spawn', { spawnId: myId, pid: ptyPid, spawnAt, sessionId, sessionSource, taskId });

      ptyProcess.onExit(({ exitCode }) => {
        const wasActive = activeSpawnId === myId;
        logger.info(
          {
            spawnId: myId,
            wasActiveSpawn: wasActive,
            exitCode,
            bytesEmitted: bytesEmittedThisSpawn,
            durationMs: Date.now() - spawnAt,
            socketId: socket.id,
          },
          'web-shell: pty exited'
        );
        if (!wasActive) {
          // We've already moved on to a new spawn. Don't emit any
          // output or exit events for this dead spawn — they would
          // land on the new spawn's canvas and corrupt it.
          return;
        }
        socket.emit('webshell:output', `\r\n\x1b[33m--- Shell exited (${exitCode}) ---\x1b[0m\r\n`);
        socket.emit('webshell:exit', { exitCode, spawnId: myId });
        ptyProcess = null;
        activeSpawnId = null;
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
