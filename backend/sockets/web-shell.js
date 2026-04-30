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
// Wire format (client ↔ server) — `feat-shell-background-sessions-001` Phase 1
// migrated every event payload to a `{ taskId, ... }` discriminator shape so
// later phases can route N PTYs per socket. taskId is null for the legacy
// non-task callers (and for the global-shell modal until Phase 5):
//   client → server   webshell:start  { taskId, cols?, rows?, command?, sessionId?, tryResume?, rotate? }
//                     webshell:input  { taskId, data }
//                     webshell:resize { taskId, cols, rows }
//   server → client   webshell:output { taskId, data }
//                     webshell:exit   { taskId, exitCode, spawnId }
//                     webshell:spawn  { taskId, spawnId, pid, spawnAt, sessionId, sessionSource }
//
// `command` (optional): when set, server spawns `cmd.exe /c <command>`
// directly so there's no banner/prompt before the launched CLI takes
// over the canvas. When unset, an interactive cmd.exe is spawned.
//
// Phase 2 introduced a `Map<taskId, ptyEntry>` per socket so background
// sessions stay alive when the user navigates to a different task: a
// `webshell:start` for an existing taskId with `tryResume:true` reattaches
// (no kill, sentinel emit) instead of respawning. `tryResume:false` or
// `rotate:true` still kill+respawn that taskId's entry. Cap is soft in
// phase 2 (warning log at `WEB_SHELL_MAX_PTYS`); phase 4 enforces eviction.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const pty = require('node-pty');
const { logger } = require('../lib/logger');
const { SETTINGS_FILE } = require('../lib/constants');
const { getAllTasks, updateTaskField } = require('../lib/tasks');

const DEFAULT_SHELL = process.env.WEB_SHELL_DEFAULT_SHELL || 'cmd.exe';

// Soft cap on concurrent PTYs per socket (`feat-shell-background-sessions-001`
// Phase 2). Phase 2 only LOGS a warning when ptyMap.size >= MAX_PTYS so the
// behavior change is small (PTYs survive task switches) without yet adding
// the full eviction loop. Phase 4 enforces eviction (kill the longest-idle
// entry to make room) and adds the user-visible "session evicted" badge.
const MAX_PTYS = (() => {
  const raw = parseInt(process.env.WEB_SHELL_MAX_PTYS, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
})();

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
  // Map<key, ptyEntry> — one entry per (socket, taskId). taskId may be null
  // for legacy callers and the global-shell modal (until Phase 5 collapses
  // that workaround); NULL_KEY collapses null/undefined into a single entry.
  //
  // ptyEntry shape:
  //   ptyProcess              — node-pty handle.
  //   activeSpawnId           — current spawn's id. Per-PTY stale-emission
  //                             filter (`bug-shell-resume-render-001`): a
  //                             respawn within the SAME taskId replaces
  //                             entry.activeSpawnId, so late onData/onExit
  //                             from the dying PTY (carrying the old myId
  //                             in their closure) get dropped. Cross-taskId
  //                             bleed is impossible because each taskId has
  //                             its own entry.
  //   bytesEmittedThisSpawn   — running counter for diagnostic logs.
  //   lastActivityTs          — updated on input received, output emitted,
  //                             or resize. Phase 4 reads this to pick the
  //                             eviction victim; phase 2 just keeps it warm.
  //   sessionId / spawnAt     — captured at spawn time; reused by the
  //                             reattach sentinel emitted when the user
  //                             returns to a task whose PTY is still alive.
  //   taskId                  — original taskId (may be null); kept on the
  //                             entry alongside the key so emit stamping
  //                             doesn't have to undo the NULL_KEY mapping.
  const ptyMap = new Map();
  const NULL_KEY = '__null_taskid__';
  const keyFor = (taskId) => (taskId == null ? NULL_KEY : taskId);

  socket.on('webshell:start', async (config = {}) => {
    const startReceivedAt = Date.now();
    try {
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
      const key = keyFor(taskId);
      const existing = ptyMap.get(key);

      // Reattach path: existing entry + caller wants the existing session
      // (default tryResume + !rotate). Don't kill, don't respawn — emit a
      // fresh spawn sentinel so the frontend can resync and treat the live
      // PTY as its connected source. This is the load-bearing piece of
      // background-session preservation: switching back to a task picks up
      // the live claude conversation instead of starting fresh. Frontend
      // xterm scrollback fidelity comes in Phase 3 (multi-instance manager
      // keeps the xterm alive across switches); until then, the reattached
      // canvas may look blank because the old xterm was unmounted on
      // task-switch — but the underlying PTY and its claude state survive,
      // which is the whole point of this phase.
      if (existing && tryResume && !rotate) {
        existing.lastActivityTs = Date.now();
        socket.emit('webshell:spawn', {
          spawnId: existing.activeSpawnId,
          pid: existing.ptyProcess.pid,
          spawnAt: existing.spawnAt,
          sessionId: existing.sessionId,
          sessionSource: 'reattach',
          taskId,
        });
        logger.info(
          {
            socketId: socket.id,
            taskId,
            spawnId: existing.activeSpawnId,
            sessionId: existing.sessionId,
            ptyMapSize: ptyMap.size,
            action: 'reattach',
          },
          'web-shell: reattached to existing PTY for this taskId'
        );
        return;
      }

      // Reserve a fresh spawn id for the spawn (or replace) path below.
      const spawnId = nextSpawnId++;
      logger.info(
        {
          spawnId,
          socketId: socket.id,
          startReceivedAt,
          configKeys: Object.keys(config),
          configPreview: {
            cols, rows,
            command: config.command,
            sessionId: config.sessionId,
            taskId,
            tryResume,
            rotate,
          },
          existingEntry: existing
            ? { spawnId: existing.activeSpawnId, bytesEmitted: existing.bytesEmittedThisSpawn }
            : null,
          ptyMapSize: ptyMap.size,
        },
        'web-shell: webshell:start received'
      );

      if (existing) {
        // tryResume:false OR rotate:true → user wants a fresh spawn for THIS
        // taskId (e.g., clicking "Start New Session" on the recovery overlay).
        // Kill the existing entry; the new spawn replaces it below.
        const dyingSpawnId = existing.activeSpawnId;
        const dyingBytes = existing.bytesEmittedThisSpawn;
        try { existing.ptyProcess.kill(); } catch { /* already dead */ }
        ptyMap.delete(key);
        logger.info(
          {
            killedSpawnId: dyingSpawnId,
            replacedBySpawnId: spawnId,
            bytesEmittedBeforeKill: dyingBytes,
            socketId: socket.id,
            taskId,
            reason: rotate ? 'rotate' : 'tryResume:false',
          },
          'web-shell: killed prior PTY before respawn (same taskId)'
        );
      }

      // Soft-cap warning. Phase 2 only logs; Phase 4 enforces eviction
      // (kill the longest-idle entry to make room). Worth surfacing now
      // so the user sees they're approaching the cap before phase 4 ships.
      if (ptyMap.size >= MAX_PTYS) {
        logger.warn(
          {
            socketId: socket.id,
            currentSize: ptyMap.size,
            max: MAX_PTYS,
            taskId,
            spawnId,
          },
          'web-shell: PTY soft cap reached — eviction not yet enforced (phase 4)'
        );
      }

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
        { spawnId, taskId, sessionId, sessionSource, rotate, tryResume, socketId: socket.id },
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
          spawnId, cwd, cols, rows, command, sessionId, tryResume,
          spawnCmd, spawnArgs, socketId: socket.id, taskId,
          spawnTimingMs: Date.now() - startReceivedAt,
        },
        'web-shell: spawning PTY'
      );

      const ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      const ptyPid = ptyProcess.pid;
      const spawnAt = Date.now();

      const entry = {
        ptyProcess,
        activeSpawnId: spawnId,
        bytesEmittedThisSpawn: 0,
        lastActivityTs: spawnAt,
        sessionId,
        spawnAt,
        taskId,
      };
      ptyMap.set(key, entry);

      // Bind closures to (myKey, myId) — Map lookup re-resolves the entry
      // each emit so a respawn that replaced the entry is observed (the
      // new entry has a different activeSpawnId and the old closure's
      // myId no longer matches → drop). The guard logic carries forward
      // bug-shell-resume-render-001's per-spawn filter, just per-PTY now.
      const myId = spawnId;
      const myKey = key;
      ptyProcess.onData((data) => {
        const liveEntry = ptyMap.get(myKey);
        if (!liveEntry || liveEntry.activeSpawnId !== myId) {
          if (process.env.WEBSHELL_BYTE_TRACE === '1') {
            logger.debug(
              {
                spawnId: myId,
                liveSpawnId: liveEntry?.activeSpawnId ?? null,
                bytes: data.length,
                socketId: socket.id,
                taskId,
              },
              'web-shell: dropped onData from non-active spawn'
            );
          }
          return;
        }
        liveEntry.bytesEmittedThisSpawn += data.length;
        liveEntry.lastActivityTs = Date.now();
        if (process.env.WEBSHELL_BYTE_TRACE === '1') {
          logger.debug(
            {
              spawnId: myId,
              bytes: data.length,
              preview: data.length > 60 ? data.slice(0, 60) + '...' : data,
              elapsedMs: Date.now() - spawnAt,
              socketId: socket.id,
              taskId,
            },
            'web-shell: pty.onData'
          );
        }
        socket.emit('webshell:output', { taskId, data });
      });

      // Spawn sentinel: tells the frontend a new PTY is live for this
      // taskId; carries the resolved sessionId so the recovery overlay
      // and localStorage cache stay in sync with the task YAML.
      socket.emit('webshell:spawn', { spawnId: myId, pid: ptyPid, spawnAt, sessionId, sessionSource, taskId });

      ptyProcess.onExit(({ exitCode }) => {
        const liveEntry = ptyMap.get(myKey);
        const wasActive = !!liveEntry && liveEntry.activeSpawnId === myId;
        logger.info(
          {
            spawnId: myId,
            wasActiveSpawn: wasActive,
            exitCode,
            bytesEmitted: liveEntry?.bytesEmittedThisSpawn ?? 0,
            durationMs: Date.now() - spawnAt,
            socketId: socket.id,
            taskId,
          },
          'web-shell: pty exited'
        );
        if (!wasActive) {
          // We've already moved on to a new spawn for this taskId. Don't
          // emit any output or exit events for this dead spawn — they
          // would land on the new spawn's canvas and corrupt it.
          return;
        }
        socket.emit('webshell:output', { taskId, data: `\r\n\x1b[33m--- Shell exited (${exitCode}) ---\x1b[0m\r\n` });
        socket.emit('webshell:exit', { exitCode, spawnId: myId, taskId });
        ptyMap.delete(myKey);
      });
    } catch (err) {
      logger.error({ err, socketId: socket.id }, 'web-shell PTY spawn error');
      // No active entry to attribute the error to — emit with whatever
      // taskId came in on the start config (may be null).
      const errTaskId = typeof config?.taskId === 'string' ? config.taskId : null;
      socket.emit('webshell:output', {
        taskId: errTaskId,
        data: `\r\n\x1b[31mError starting terminal: ${err.message}\x1b[0m\r\n`,
      });
    }
  });

  // Wire format (`feat-shell-background-sessions-001` Phase 1): payload is
  // `{ taskId, data }` instead of raw bytes. Phase 2 routes via the Map —
  // missing entry means we got input for a taskId whose PTY isn't on this
  // socket (closed, evicted, or never spawned); drop silently rather than
  // crashing on an undefined ptyProcess.
  socket.on('webshell:input', (payload) => {
    if (!payload || typeof payload.data !== 'string') return;
    const entry = ptyMap.get(keyFor(payload.taskId));
    if (!entry) return;
    entry.lastActivityTs = Date.now();
    entry.ptyProcess.write(payload.data);
  });

  // Wire format Phase 1: payload is `{ taskId, cols, rows }`. Phase 2 routes
  // via the Map. taskId-less resizes are dropped; cols/rows still read at
  // the top level for backwards-compat with the wrapper shape.
  socket.on('webshell:resize', (size) => {
    if (!size) return;
    const entry = ptyMap.get(keyFor(size.taskId));
    if (!entry) return;
    entry.lastActivityTs = Date.now();
    try {
      entry.ptyProcess.resize(size.cols, size.rows);
    } catch {
      // resize on a dead pty throws — safe to ignore
    }
  });

  // Socket disconnect kills every PTY on this socket. Phase 2 doesn't
  // change disconnect semantics (page reload still drops everything);
  // persistence-across-reload is explicitly out of scope per parent Q8.
  return () => {
    if (ptyMap.size > 0) {
      logger.info(
        { socketId: socket.id, count: ptyMap.size, keys: Array.from(ptyMap.keys()) },
        'Cleaning up web-shell PTYs (socket disconnect)'
      );
      for (const [, entry] of ptyMap) {
        try { entry.ptyProcess.kill(); } catch { /* already dead */ }
      }
      ptyMap.clear();
    }
  };
};

module.exports = { registerWebShellHandlers };
