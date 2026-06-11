// Public hook receiver for the Auto-Enter Notification signal
// (feat-autoenter-hook-signal-001).
//
// A Claude Code `Notification` hook (matcher: permission_prompt), configured
// in the web-shell's working-directory .claude/settings.json, POSTs here the
// instant claude presents a permission prompt. We resolve which task the
// prompt belongs to and broadcast `webshell:prompt` over socket.io so the
// frontend AutoEnterToggle can fire Enter — replacing the fragile
// PTY-output regex scraping (autoEnterPatterns.js) with an authoritative
// signal straight from the running claude process.
//
// AUTH POSTURE (deliberate): this endpoint is mounted WITHOUT requireAuth,
// because the caller is the `claude` child process, which holds no Atrium
// JWT. The backend binds 0.0.0.0, so to stop anyone on the LAN from
// injecting fake prompt events (which would make armed terminals
// auto-press Enter), the endpoint requires a shared secret WHEN
// `ATRIUM_HOOK_TOKEN` is set in the backend environment. That same secret
// is inherited by the spawned claude (via the web-shell's process.env
// passthrough) and forwarded by the hook's Authorization header. When the
// env var is unset (single-user dev box), the token check is skipped so
// the feature works out of the box on localhost.

const express = require('express');
const { logger } = require('../lib/logger');
const { getIO } = require('../lib/io');
const { getAllTasks } = require('../lib/tasks');

const router = express.Router();

// Resolve the task id a Notification belongs to. Header wins (the hook
// forwards $ATRIUM_TASK_ID verbatim); falls back to matching the claude
// session_id against tasks' `claude_session_id` (the same field web-shell.js
// binds per task). `loadTasks` is injectable so this stays unit-testable
// without touching the real tasks directory. Returns the task id or null.
function resolveTaskId({ headerTaskId, sessionId, loadTasks = getAllTasks } = {}) {
  const fromHeader = typeof headerTaskId === 'string' ? headerTaskId.trim() : '';
  if (fromHeader) return fromHeader;
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (sid) {
    try {
      const match = loadTasks().find((t) => t && t.claude_session_id === sid);
      if (match) return match.id;
    } catch (err) {
      logger.warn({ err, sessionId: sid }, 'autoenter-hook: session->task lookup failed');
    }
  }
  return null;
}

// Validate the shared secret when one is configured. No env var → allow
// (dev). Accepts either `Authorization: Bearer <token>` or a bare
// `X-Atrium-Hook-Token` header so the hook config can use whichever is
// simpler. Exported for tests.
function tokenOk(req, env = process.env) {
  const expected = env.ATRIUM_HOOK_TOKEN;
  if (!expected) return true;
  const auth = (req.get && req.get('authorization')) || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headerTok = (req.get && req.get('x-atrium-hook-token')) || '';
  return bearer === expected || headerTok === expected;
}

// POST /  (mounted at /api/autoenter/hook) — receives one CC Notification.
//
// Always acks with 2xx so the hook never blocks claude (a Notification hook
// makes no decision; an empty 2xx is the correct "received, no output"
// response per the hook HTTP contract). The only non-2xx is 401 for a bad
// token, which signals a misconfigured secret without leaking detail.
router.post('/', (req, res) => {
  if (!tokenOk(req)) {
    return res.status(401).json({ error: 'invalid hook token' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const notificationType = typeof body.notification_type === 'string' ? body.notification_type : '';
  const message = typeof body.message === 'string' ? body.message : '';
  const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
  const headerTaskId = (req.get && req.get('x-atrium-task-id')) || '';

  const taskId = resolveTaskId({ headerTaskId, sessionId });
  if (!taskId) {
    // Not a web-shell-spawned claude (manual session, or unresolvable) —
    // ack so the hook never blocks, but do nothing.
    return res.status(200).json({ ok: true, ignored: 'no task correlation' });
  }

  // Only the permission-prompt notification is actionable for auto-enter.
  // Other types (idle_prompt, auth_success, elicitation_*) are acked and
  // ignored so the matcher can be loosened later without a code change.
  if (notificationType && notificationType !== 'permission_prompt') {
    return res.status(200).json({ ok: true, ignored: `type ${notificationType}` });
  }

  const io = getIO();
  if (io) {
    try {
      io.emit('webshell:prompt', {
        taskId,
        message,
        notificationType: notificationType || 'permission_prompt',
      });
    } catch (err) {
      logger.warn({ err, taskId }, 'autoenter-hook: webshell:prompt emit failed');
    }
  }
  logger.info(
    { taskId, notificationType: notificationType || 'permission_prompt', hasMessage: !!message },
    'autoenter-hook: permission prompt signaled',
  );
  return res.status(200).json({ ok: true });
});

module.exports = { router, resolveTaskId, tokenOk };
