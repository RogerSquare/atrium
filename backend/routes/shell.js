// REST endpoints for the active-shell-sessions registry
// (`feat-shell-lifecycle-001` Slice 2). Backs the kanban indicator data
// fetch and the global "active terminals" panel.
//
// All routes are mounted under /api/shell with `requireAuth` in server.js,
// matching the rest of the protected API surface.
//
// Live updates ride on the `shell_sessions_changed` socket event broadcast
// by `sockets/web-shell.js` on every registry mutation. The REST endpoints
// here are for initial load + the explicit Kill action; everyday reactive
// updates should come from the socket stream.

const express = require('express');
const { logger } = require('../lib/logger');
const { taskPtyRegistry, getSessionsSnapshot } = require('../sockets/web-shell');

const router = express.Router();

// GET /api/shell/sessions
// Returns the snapshot used by the broadcast event. Clients fetch this
// once on mount, then maintain state via shell_sessions_changed.
router.get('/sessions', (req, res) => {
  res.json({ sessions: getSessionsSnapshot() });
});

// POST /api/shell/sessions/:taskId/kill
// User-initiated termination of an alive PTY (e.g., from the active-
// terminals panel). Kills the underlying node-pty process; the existing
// onExit handler in web-shell.js fires the standard webshell:exit event
// to whatever socket is currently attached (if any), deletes the entry
// from the registry, and broadcasts shell_sessions_changed. We don't
// duplicate any of that here — the kill is the only side effect.
router.post('/sessions/:taskId/kill', (req, res) => {
  const { taskId } = req.params;
  const entry = taskPtyRegistry.get(taskId);
  if (!entry) {
    return res.status(404).json({ error: 'No active shell session for this taskId' });
  }
  logger.info(
    {
      taskId,
      spawnId: entry.activeSpawnId,
      attached: entry.socket != null,
      detachedAt: entry.detachedAt,
      bytesEmitted: entry.bytesEmittedThisSpawn,
      reason: 'rest-kill',
      actor: req.user?.username || 'unknown',
    },
    'web-shell: session killed via REST'
  );
  try {
    entry.ptyProcess.kill();
  } catch (err) {
    // Already dead — entry will be reaped by onExit anyway.
    logger.debug({ err, taskId }, 'web-shell: kill on already-dead PTY');
  }
  res.json({ killed: true, taskId });
});

module.exports = router;
