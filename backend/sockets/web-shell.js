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
// later phases can route N PTYs per socket. Phase 4 added the close + evicted
// events. taskId is null for the legacy non-task callers (and for the global-
// shell modal until Phase 5):
//   client → server   webshell:start  { taskId, cols?, rows?, command?, sessionId?, tryResume?, rotate? }
//                     webshell:input  { taskId, data }
//                     webshell:resize { taskId, cols, rows }
//                     webshell:close  { taskId }
//   server → client   webshell:output { taskId, data }
//                     webshell:exit   { taskId, exitCode, spawnId }
//                     webshell:spawn  { taskId, spawnId, pid, spawnAt, sessionId, sessionSource }
//                     webshell:evicted { taskId }
//
// `command` (optional): when set, server spawns `cmd.exe /c <command>`
// directly so there's no banner/prompt before the launched CLI takes
// over the canvas. When unset but a claude session is bound, the resolved
// claude binary is spawned DIRECTLY (no cmd.exe) via ../lib/claudeBin.js —
// see opt-webshell-claude-path-001. When neither, an interactive cmd.exe.
//
// Phase 2 introduced a `Map<taskId, ptyEntry>` per socket so background
// sessions stay alive when the user navigates to a different task: a
// `webshell:start` for an existing taskId with `tryResume:true` reattaches
// (no kill, sentinel emit) instead of respawning. `tryResume:false` or
// `rotate:true` still kill+respawn that taskId's entry. Cap is soft in
// phase 2 (warning log at `WEB_SHELL_MAX_PTYS`); phase 4 enforces eviction.

const fs = require('fs');
const crypto = require('crypto');
const pty = require('node-pty');
const { logger } = require('../lib/logger');
const { SETTINGS_FILE } = require('../lib/constants');
const { getAllTasks, updateTaskField } = require('../lib/tasks');
const { resolveClaudeBin, buildClaudeArgs, claudeVersion } = require('../lib/claudeBin');

const DEFAULT_SHELL = process.env.WEB_SHELL_DEFAULT_SHELL || 'cmd.exe';

// Soft cap on concurrent taskId-bound PTYs (`feat-shell-background-sessions-001`
// Phase 2 introduced; `feat-shell-lifecycle-001` Slice 1 made it global).
// Eviction kills the longest-idle entry in `taskPtyRegistry` to make room
// when a brand-new taskId is being spawned. NULL_KEY entries don't count.
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

// Session-file path resolution and the claude-launch decision now live in
// ../lib/claudeBin.js (resolveClaudeBin / buildClaudeArgs), so the binary
// is resolved to a concrete absolute path instead of a bare PATH lookup and
// the whole decision is unit-tested. See opt-webshell-claude-path-001.

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

// === Slice 2 broadcast plumbing (`feat-shell-lifecycle-001`) ===
//
// server.js calls setIO(io) once at startup so this module can broadcast
// `shell_sessions_changed` whenever the registry mutates. Every client
// receives the full snapshot — same shape as the REST endpoint, so the
// frontend can either subscribe to live updates or fetch on demand and
// the data model is identical.
let _io = null;
const setIO = (io) => { _io = io; };

// Public-shape snapshot used by both the broadcast event and
// `routes/shell.js`. Must NOT leak the live socket reference or the
// node-pty handle — only stable, serializable fields.
function getSessionsSnapshot() {
  const out = [];
  for (const entry of taskPtyRegistry.values()) {
    out.push({
      taskId: entry.taskId,
      spawnId: entry.activeSpawnId,
      sessionId: entry.sessionId,
      pid: entry.ptyProcess.pid,
      attached: entry.socket != null,
      detachedAt: entry.detachedAt,
      lastActivityTs: entry.lastActivityTs,
      spawnAt: entry.spawnAt,
      bytesEmitted: entry.bytesEmittedThisSpawn,
      processing: !!entry.processing,
    });
  }
  return out;
}

function broadcastSessions() {
  if (!_io) return;
  try {
    _io.emit('shell_sessions_changed', { sessions: getSessionsSnapshot() });
  } catch (err) {
    logger.warn({ err }, 'web-shell: shell_sessions_changed broadcast failed');
  }
}

// === Module-global PTY registry (`feat-shell-lifecycle-001` Slice 1) ===
//
// taskId-bound PTYs outlive the originating socket. When the user closes
// the browser tab (socket disconnect), the entry's `socket` ref is cleared
// and `detachedAt` is stamped, but the PTY keeps running. A subsequent
// webshell:start for the same taskId from any socket atomically reattaches
// to the live PTY. Single-user assumption per project memory — one global
// registry, no per-user partitioning.
//
// NULL_KEY entries (legacy non-task callers, global-shell modal) remain
// per-socket and ephemeral. They live in a Map<NULL_KEY, entry> inside
// each registerWebShellHandlers closure and die with their socket — the
// modal flow has no notion of "the same modal session" across page loads.
//
// Entry shape gains two fields vs. pre-Slice-1:
//   socket       — currently-attached Socket.IO socket, or null when
//                  detached. Read by onData/onExit each emit so a
//                  reattach to a different socket routes new output to
//                  the live attachment.
//   detachedAt   — ms timestamp of the detach event, null while attached.
//                  Idle-GC reads this to pick teardown victims.
const taskPtyRegistry = new Map();

// Idle GC: walk the registry every WEB_SHELL_GC_INTERVAL_MS; kill any
// entry that has been detached for WEB_SHELL_DETACHED_MAX_MS, OR that has
// produced no PTY output for WEB_SHELL_IDLE_MAX_MS. Defaults: 60s walk,
// 24h thresholds. Both window envs are checked independently so an
// always-attached but truly-idle PTY (e.g. a forgotten interactive shell
// nobody is typing into) still ages out.
const GC_INTERVAL_MS = Number.parseInt(process.env.WEB_SHELL_GC_INTERVAL_MS, 10) || 60_000;
const DETACHED_MAX_MS = Number.parseInt(process.env.WEB_SHELL_DETACHED_MAX_MS, 10) || 24 * 60 * 60 * 1000;
const IDLE_MAX_MS = Number.parseInt(process.env.WEB_SHELL_IDLE_MAX_MS, 10) || 24 * 60 * 60 * 1000;

// Slice 3: "processing" signal threshold. After this many ms of PTY
// output silence, the entry's processing flag flips back to false and
// an idle event broadcasts. Default 1500ms — short enough to feel live,
// long enough that a flurry of output (a `claude` token-streamed
// response) doesn't toggle on/off rapidly. Override via env if a
// specific shell has chunkier output.
const PROCESSING_IDLE_MS = Number.parseInt(process.env.WEB_SHELL_PROCESSING_IDLE_MS, 10) || 1500;

// Mark an entry as processing (leading edge) and arm/reset the idle
// timer. Called from onData on every chunk. Broadcasts `webshell:processing`
// to all clients on state-change only — repeated chunks while already
// processing are silent.
function markProcessing(entry) {
  if (!entry.processing) {
    entry.processing = true;
    if (_io) {
      try { _io.emit('webshell:processing', { taskId: entry.taskId, active: true }); } catch { /* ignore */ }
    }
  }
  if (entry.processingIdleTimer) clearTimeout(entry.processingIdleTimer);
  entry.processingIdleTimer = setTimeout(() => {
    entry.processing = false;
    entry.processingIdleTimer = null;
    if (_io) {
      try { _io.emit('webshell:processing', { taskId: entry.taskId, active: false }); } catch { /* ignore */ }
    }
  }, PROCESSING_IDLE_MS);
  if (typeof entry.processingIdleTimer.unref === 'function') entry.processingIdleTimer.unref();
}

// Cancel any armed idle timer and clear processing flag. Used by the
// onExit / kill / GC paths so a dying entry doesn't fire a stale
// active:false event after its taskId is gone.
function clearProcessing(entry) {
  if (entry.processingIdleTimer) {
    clearTimeout(entry.processingIdleTimer);
    entry.processingIdleTimer = null;
  }
  entry.processing = false;
}

const gcTimer = setInterval(() => {
  const now = Date.now();
  for (const [taskId, entry] of taskPtyRegistry) {
    const detachedTooLong = entry.detachedAt != null && now - entry.detachedAt > DETACHED_MAX_MS;
    const idleTooLong = now - entry.lastActivityTs > IDLE_MAX_MS;
    if (!detachedTooLong && !idleTooLong) continue;
    clearProcessing(entry);
    try { entry.ptyProcess.kill(); } catch { /* already dead */ }
    taskPtyRegistry.delete(taskId);
    logger.info(
      {
        taskId,
        spawnId: entry.activeSpawnId,
        reason: detachedTooLong ? 'detached-too-long' : 'idle-too-long',
        detachedAt: entry.detachedAt,
        lastActivityTs: entry.lastActivityTs,
        ageMs: detachedTooLong ? now - entry.detachedAt : now - entry.lastActivityTs,
      },
      'web-shell: idle-GC killed PTY'
    );
    broadcastSessions();
  }
}, GC_INTERVAL_MS);
if (typeof gcTimer.unref === 'function') gcTimer.unref();

// Find the entry with smallest lastActivityTs in the module-global
// registry, kill its PTY, remove it, and emit `webshell:evicted` to
// the entry's currently-attached socket (if any) so the frontend can
// render the "session evicted" badge. Returns `{ taskId, idleMs }` for
// the caller to log, or null if the registry was empty.
//
// Eviction is silent at the wire level (no webshell:exit fires) — the
// killed PTY's onExit sees the entry is already gone and bails via its
// `wasActive` guard. NULL_KEY entries are NOT eligible for eviction;
// they're per-socket ephemeral and only the registry counts toward
// MAX_PTYS.
function evictLongestIdleEntry() {
  let oldestKey = null;
  let oldestTs = Infinity;
  for (const [key, entry] of taskPtyRegistry) {
    if (entry.lastActivityTs < oldestTs) {
      oldestTs = entry.lastActivityTs;
      oldestKey = key;
    }
  }
  if (oldestKey === null) return null;
  const entry = taskPtyRegistry.get(oldestKey);
  const evictedTaskId = entry.taskId;
  const idleMs = Date.now() - oldestTs;
  clearProcessing(entry);
  try { entry.ptyProcess.kill(); } catch { /* already dead */ }
  taskPtyRegistry.delete(oldestKey);
  if (entry.socket) {
    try { entry.socket.emit('webshell:evicted', { taskId: evictedTaskId }); } catch { /* socket dead */ }
  }
  broadcastSessions();
  return { taskId: evictedTaskId, idleMs };
}

const registerWebShellHandlers = (socket) => {
  // Per-socket map of NULL_KEY entries (legacy non-task callers + global
  // shell modal). These are ephemeral — killed on socket disconnect, same
  // as pre-Slice-1 behavior. They never participate in eviction or idle GC.
  // taskId-bound entries live in the module-global `taskPtyRegistry` (above)
  // and outlive the socket; getEntry/setEntry/deleteEntry dispatch to the
  // right store based on `taskId == null`.
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
  //                             or resize. Eviction + idle-GC read this.
  //   sessionId / spawnAt     — captured at spawn time; reused by the
  //                             reattach sentinel emitted when the user
  //                             returns to a task whose PTY is still alive.
  //   taskId                  — original taskId (may be null); kept on the
  //                             entry so emit stamping doesn't have to undo
  //                             the NULL_KEY mapping.
  //   socket                  — Slice 1: currently-attached Socket.IO socket
  //                             (or null when detached). Read by onData /
  //                             onExit each emit so cross-socket reattach
  //                             reroutes output to the new attachment.
  //   detachedAt              — Slice 1: ms timestamp of detach (null while
  //                             attached). Always null for NULL_KEY entries
  //                             since they're killed on disconnect.
  const nullPtyMap = new Map();
  const NULL_KEY = '__null_taskid__';

  const getEntry = (taskId) =>
    (taskId == null ? nullPtyMap.get(NULL_KEY) : taskPtyRegistry.get(taskId));
  // Slice 2: setEntry/deleteEntry on taskId entries broadcast the
  // updated registry snapshot so all clients (kanban indicators, the
  // active-terminals panel) update live. NULL_KEY mutations don't
  // broadcast — they're per-socket modal state that other clients
  // shouldn't see.
  const setEntry = (taskId, entry) => {
    if (taskId == null) {
      nullPtyMap.set(NULL_KEY, entry);
      return;
    }
    taskPtyRegistry.set(taskId, entry);
    broadcastSessions();
  };
  const deleteEntry = (taskId) => {
    if (taskId == null) {
      nullPtyMap.delete(NULL_KEY);
      return;
    }
    taskPtyRegistry.delete(taskId);
    broadcastSessions();
  };

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
      const existing = getEntry(taskId);

      // Reattach path: existing entry + caller wants the existing session
      // (default tryResume + !rotate). Don't kill, don't respawn — emit a
      // fresh spawn sentinel so the frontend can resync and treat the live
      // PTY as its connected source.
      //
      // Slice 1 widened reattach to cross-socket: the existing entry may be
      // currently attached to a DIFFERENT socket (separate browser tab) or
      // detached (its prior socket disconnected). Either way, this start
      // takes over the attachment — entry.socket flips to `socket`, and
      // entry.detachedAt clears. Subsequent onData emits route to the new
      // socket. The prior socket (if any) goes silent for this taskId; the
      // user-visible effect is "shell follows you to the active tab".
      if (existing && tryResume && !rotate) {
        const wasDetached = existing.detachedAt != null;
        const priorSocketId = existing.socket?.id ?? null;
        existing.socket = socket;
        existing.detachedAt = null;
        existing.lastActivityTs = Date.now();
        // Order matters here. Resize triggers SIGWINCH → the running TUI
        // (claude) responds by emitting a full-screen redraw via onData,
        // which races toward webshell:output emits on the SAME socket.
        // The frontend handles 'reattach' spawn sentinels by calling
        // term.reset() to return the xterm to a known-clean state — if
        // redraw bytes arrive before the sentinel does, they land in the
        // not-yet-reset xterm and the cursor parks at the wrong corner.
        //
        // To make the ordering bulletproof we:
        //   1. Emit the spawn sentinel FIRST so it's queued on the socket
        //      ahead of any output bytes (Socket.IO maintains FIFO order
        //      per-socket).
        //   2. Broadcast the snapshot for the live indicator.
        //   3. Resize LAST so the SIGWINCH-triggered redraw output is
        //      always emitted after the sentinel.
        socket.emit('webshell:spawn', {
          spawnId: existing.activeSpawnId,
          pid: existing.ptyProcess.pid,
          spawnAt: existing.spawnAt,
          sessionId: existing.sessionId,
          sessionSource: 'reattach',
          taskId,
        });
        // Slice 2: attached/detached state changed — broadcast so every
        // client's "active terminals" view + kanban indicator updates.
        broadcastSessions();
        try {
          if (Number.isFinite(config.cols) && Number.isFinite(config.rows)) {
            existing.ptyProcess.resize(config.cols, config.rows);
          }
        } catch {
          // resize on a dead pty throws — onExit will reap it
        }
        logger.info(
          {
            socketId: socket.id,
            taskId,
            spawnId: existing.activeSpawnId,
            sessionId: existing.sessionId,
            registrySize: taskPtyRegistry.size,
            wasDetached,
            priorSocketId,
            action: wasDetached ? 'reattach-after-detach' : (priorSocketId && priorSocketId !== socket.id ? 'reattach-cross-socket' : 'reattach'),
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
            ? { spawnId: existing.activeSpawnId, bytesEmitted: existing.bytesEmittedThisSpawn, detached: existing.detachedAt != null }
            : null,
          registrySize: taskPtyRegistry.size,
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
        deleteEntry(taskId);
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

      // Cap enforcement (`feat-shell-background-sessions-001` Phase 4,
      // updated for Slice 1). The cap now applies to the module-global
      // `taskPtyRegistry` only — NULL_KEY entries are per-socket and
      // ephemeral, so they don't count. Eviction fires when we're about to
      // ADD a new taskId entry. Replace (existing && rotate/!tryResume)
      // doesn't grow the registry; reattach returned early above.
      if (taskId != null && !existing && taskPtyRegistry.size >= MAX_PTYS) {
        const evicted = evictLongestIdleEntry();
        if (evicted) {
          logger.info(
            {
              socketId: socket.id,
              evictedTaskId: evicted.taskId,
              idleMs: evicted.idleMs,
              replacedByTaskId: taskId,
              spawnId,
              registrySizeAfter: taskPtyRegistry.size,
            },
            'web-shell: evicted longest-idle PTY at cap'
          );
        }
      } else if (taskId != null && !existing && taskPtyRegistry.size >= MAX_PTYS - 1) {
        logger.info(
          {
            socketId: socket.id,
            currentSize: taskPtyRegistry.size,
            max: MAX_PTYS,
            taskId,
            spawnId,
          },
          'web-shell: PTY count approaching cap; next new task will evict the longest-idle'
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

      // Decide what to spawn. Three shapes:
      //   1. Custom `config.command` (arbitrary string, e.g. the global-shell
      //      modal) -> still run via `cmd.exe /c <command>` so PATH search and
      //      shell builtins behave as the caller expects.
      //   2. A claude session (sessionId present) -> resolve the claude binary
      //      to a concrete absolute path (opt-webshell-claude-path-001) and
      //      spawn it DIRECTLY with an args array. No cmd.exe in between, so
      //      there is no PATH ambiguity and no `cmd /c` quote-stripping to get
      //      wrong on paths with spaces — node-pty quotes argv[0] for us.
      //   3. Neither -> an interactive DEFAULT_SHELL.
      const customCommand = typeof config.command === 'string' && config.command.length > 0
        ? config.command
        : null;

      let spawnCmd;
      let spawnArgs;
      let command;            // display/log string only
      let claudeBinInfo = null;
      let claudeArgInfo = null;

      if (customCommand) {
        spawnCmd = 'cmd.exe';
        spawnArgs = ['/c', customCommand];
        command = customCommand;
      } else if (sessionId) {
        claudeBinInfo = resolveClaudeBin();
        claudeArgInfo = buildClaudeArgs(cwd, sessionId, tryResume);
        spawnCmd = claudeBinInfo.bin;
        spawnArgs = claudeArgInfo.args;
        command = `${spawnCmd} ${spawnArgs.join(' ')}`;
      } else {
        spawnCmd = DEFAULT_SHELL;
        spawnArgs = [];
        command = null;
      }

      logger.info(
        {
          spawnId, cwd, cols, rows, command, sessionId, tryResume,
          spawnCmd, spawnArgs, socketId: socket.id, taskId,
          // opt-webshell-claude-path-001: make the resolved binary + the
          // resume/session-id decision observable so any future version drift
          // is diagnosable straight from this one log line.
          claudeBin: claudeBinInfo ? claudeBinInfo.bin : null,
          claudeBinSource: claudeBinInfo ? claudeBinInfo.source : null,
          claudeBinExists: claudeBinInfo ? claudeBinInfo.exists : null,
          claudeVersion: claudeBinInfo ? claudeVersion(claudeBinInfo.bin) : null,
          claudeSessionDecision: claudeArgInfo ? claudeArgInfo.decision : null,
          claudeSessionFileExists: claudeArgInfo ? claudeArgInfo.sessionFileExists : null,
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
        // Slice 1: which socket is currently bound to this entry, and
        // when (if ever) it was last detached. Cross-socket reattach
        // mutates these; idle-GC reads detachedAt to age out zombies.
        socket,
        detachedAt: null,
        // Slice 3: processing-state flag + idle timer. onData sets
        // processing:true on the leading edge and arms a setTimeout that
        // flips it back to false after PROCESSING_IDLE_MS of silence. The
        // flag is included in getSessionsSnapshot so kanban indicators
        // reflect "shell is producing output" vs "shell is alive but idle".
        processing: false,
        processingIdleTimer: null,
      };
      setEntry(taskId, entry);

      // Bind closures to (myTaskId, myId). onData/onExit re-resolve the
      // entry from getEntry each emit so:
      //   1. Stale-spawn-id filter (`bug-shell-resume-render-001`) still
      //      works — a respawn within the same taskId replaces the entry,
      //      its activeSpawnId differs from the old closure's myId, drop.
      //   2. Cross-socket reattach (Slice 1) is observed — onData reads
      //      liveEntry.socket each call, so output routes to the
      //      currently-attached socket (or no-op when detached).
      const myId = spawnId;
      const myTaskId = taskId;
      ptyProcess.onData((data) => {
        const liveEntry = getEntry(myTaskId);
        if (!liveEntry || liveEntry.activeSpawnId !== myId) {
          if (process.env.WEBSHELL_BYTE_TRACE === '1') {
            logger.debug(
              {
                spawnId: myId,
                liveSpawnId: liveEntry?.activeSpawnId ?? null,
                bytes: data.length,
                taskId: myTaskId,
              },
              'web-shell: dropped onData from non-active spawn'
            );
          }
          return;
        }
        liveEntry.bytesEmittedThisSpawn += data.length;
        liveEntry.lastActivityTs = Date.now();
        markProcessing(liveEntry);
        if (process.env.WEBSHELL_BYTE_TRACE === '1') {
          logger.debug(
            {
              spawnId: myId,
              bytes: data.length,
              preview: data.length > 60 ? data.slice(0, 60) + '...' : data,
              elapsedMs: Date.now() - spawnAt,
              attachedSocketId: liveEntry.socket?.id ?? null,
              taskId: myTaskId,
            },
            'web-shell: pty.onData'
          );
        }
        // Detached entries (no attached socket) silently buffer-by-dropping
        // — output is lost rather than queued. This matches the existing
        // "scrollback fidelity is xterm-side" model: PTY state survives
        // tab close, but transient bytes between detach and reattach do
        // not. The reattach sentinel hands off, and any active claude
        // process that needs the user can re-prompt.
        if (liveEntry.socket) {
          try { liveEntry.socket.emit('webshell:output', { taskId: myTaskId, data }); } catch { /* socket dead */ }
        }
      });

      // Spawn sentinel: tells the frontend a new PTY is live for this
      // taskId; carries the resolved sessionId so the recovery overlay
      // and localStorage cache stay in sync with the task YAML.
      socket.emit('webshell:spawn', { spawnId: myId, pid: ptyPid, spawnAt, sessionId, sessionSource, taskId });

      ptyProcess.onExit(({ exitCode }) => {
        const liveEntry = getEntry(myTaskId);
        const wasActive = !!liveEntry && liveEntry.activeSpawnId === myId;
        logger.info(
          {
            spawnId: myId,
            wasActiveSpawn: wasActive,
            exitCode,
            bytesEmitted: liveEntry?.bytesEmittedThisSpawn ?? 0,
            durationMs: Date.now() - spawnAt,
            attachedSocketId: liveEntry?.socket?.id ?? null,
            taskId: myTaskId,
          },
          'web-shell: pty exited'
        );
        if (!wasActive) {
          // We've already moved on to a new spawn for this taskId. Don't
          // emit any output or exit events for this dead spawn — they
          // would land on the new spawn's canvas and corrupt it.
          return;
        }
        clearProcessing(liveEntry);
        if (liveEntry.socket) {
          try {
            liveEntry.socket.emit('webshell:output', { taskId: myTaskId, data: `\r\n\x1b[33m--- Shell exited (${exitCode}) ---\x1b[0m\r\n` });
            liveEntry.socket.emit('webshell:exit', { exitCode, spawnId: myId, taskId: myTaskId });
          } catch { /* socket dead */ }
        }
        deleteEntry(myTaskId);
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
  // `{ taskId, data }` instead of raw bytes. Slice 1 routes via getEntry —
  // missing entry means we got input for a taskId whose PTY isn't alive
  // anywhere (closed, evicted, GC'd, or never spawned). Drop silently.
  socket.on('webshell:input', (payload) => {
    if (!payload || typeof payload.data !== 'string') return;
    const entry = getEntry(payload.taskId);
    if (!entry) return;
    entry.lastActivityTs = Date.now();
    entry.ptyProcess.write(payload.data);
  });

  // User-initiated close (`feat-shell-background-sessions-001` Phase 4).
  // Kill the PTY and let the existing onExit handler handle the rest:
  // it sees `wasActive` true (entry still in registry at this point),
  // emits the standard "Shell exited" output + webshell:exit, then deletes
  // the entry. Frontend's existing handleExit path arms the recovery
  // overlay, so manual close → recovery overlay → user clicks Resume to
  // spawn fresh. No special-case wire event for "manual close" needed.
  socket.on('webshell:close', (payload) => {
    if (!payload) return;
    const entry = getEntry(payload.taskId);
    if (!entry) return;
    logger.info(
      {
        socketId: socket.id,
        closedTaskId: entry.taskId,
        spawnId: entry.activeSpawnId,
        bytesEmitted: entry.bytesEmittedThisSpawn,
        registrySize: taskPtyRegistry.size,
        reason: 'manual',
      },
      'web-shell: PTY close requested by user'
    );
    try { entry.ptyProcess.kill(); } catch { /* already dead */ }
    // Don't delete here — onExit handles cleanup AFTER it emits
    // webshell:exit so the frontend gets the recovery overlay.
  });

  // Wire format Phase 1: payload is `{ taskId, cols, rows }`.
  socket.on('webshell:resize', (size) => {
    if (!size) return;
    const entry = getEntry(size.taskId);
    if (!entry) return;
    entry.lastActivityTs = Date.now();
    try {
      entry.ptyProcess.resize(size.cols, size.rows);
    } catch {
      // resize on a dead pty throws — safe to ignore
    }
  });

  // Socket disconnect (Slice 1).
  //   - taskId-bound entries owned by THIS socket: detach (clear socket
  //     ref + stamp detachedAt). PTY keeps running. A future webshell:start
  //     for the same taskId will reattach (cross-socket reattach branch).
  //     Idle-GC kills entries that stay detached past WEB_SHELL_DETACHED_MAX_MS.
  //   - NULL_KEY entries (per-socket, modal flow): killed. The modal has no
  //     resume semantics, so death-on-disconnect matches the original UX.
  return () => {
    const detachedTaskIds = [];
    const detachAt = Date.now();
    for (const [taskId, entry] of taskPtyRegistry) {
      if (entry.socket === socket) {
        entry.socket = null;
        entry.detachedAt = detachAt;
        detachedTaskIds.push(taskId);
      }
    }

    const killedNullCount = nullPtyMap.size;
    for (const [, entry] of nullPtyMap) {
      try { entry.ptyProcess.kill(); } catch { /* already dead */ }
    }
    nullPtyMap.clear();

    if (detachedTaskIds.length > 0 || killedNullCount > 0) {
      logger.info(
        {
          socketId: socket.id,
          detachedTaskIds,
          killedNullEntries: killedNullCount,
          registrySize: taskPtyRegistry.size,
        },
        'web-shell: socket disconnect — taskId entries detached, null entries killed'
      );
    }
    // Slice 2: broadcast once per disconnect (not per detached entry) so
    // clients see the batched attached→detached transition. nullPtyMap
    // entries don't appear in the snapshot, so killing them doesn't
    // affect what we send.
    if (detachedTaskIds.length > 0) broadcastSessions();
  };
};

// Slice 2 — exports for `routes/shell.js` and server.js wiring:
//   taskPtyRegistry      raw Map<taskId, entry> — used by routes/shell.js's
//                        kill endpoint to look up + terminate entries.
//   getSessionsSnapshot  serializable list — used by routes/shell.js GET.
//   setIO                called once from server.js with the io instance
//                        so this module can broadcast shell_sessions_changed.
module.exports = { registerWebShellHandlers, taskPtyRegistry, getSessionsSnapshot, setIO };
