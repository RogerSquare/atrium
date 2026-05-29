// REST endpoints for the Auto-Enter prompt-capture log
// (bug-autoenter-ansi-cursor-strip-001 extension).
//
// The terminal auto-Enter toggle (frontend AutoEnterToggle.jsx) POSTs here
// so its detection decisions become analyzable server-side instead of being
// trapped in per-browser localStorage. Two streams keyed by `classification`:
//   - UNRECOGNIZED prompts ('unknown') — misses the pattern set should learn.
//   - FIRE events ('fire') — what auto-Enter actually pressed Enter on, so
//     misfires on selection menus can be diagnosed from real text
//     (bug-autoenter-misfire-menus-001). Stored in a separate file; read via
//     GET ?classification=fire.
// Mounted under /api/autoenter with `requireAuth` in server.js.
//
// The POST is fire-and-forget from the client's perspective — the toggle's
// localStorage capture is the source of truth for the in-UI review panel;
// this log is the durable analysis layer. So failures here must not break
// the client: we still 400 on genuinely malformed input, but a logged
// capture is a best-effort record, not a transaction the user waits on.

const express = require('express');
const { logger } = require('../lib/logger');
const { appendCapture, queryCaptures, clearCaptures } = require('../lib/autoEnterCaptures');

const router = express.Router();

// POST /api/autoenter/captures — record one unrecognized-prompt capture.
router.post('/captures', async (req, res) => {
  try {
    const result = await appendCapture(req.body, { user: req.user?.username });
    if (!result) {
      return res.status(400).json({ error: 'bufferTail (non-empty string) is required' });
    }
    logger.info(
      {
        taskId: result.entry.taskId,
        classification: result.entry.classification,
        total: result.total,
        actor: req.user?.username || 'unknown',
      },
      'autoenter: capture logged',
    );
    res.status(201).json({ ok: true, total: result.total });
  } catch (error) {
    logger.error({ err: error }, 'autoenter: failed to log capture');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/autoenter/captures — list captures for analysis.
// Query params: taskId, classification, limit.
router.get('/captures', (req, res) => {
  try {
    const { taskId, classification } = req.query;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const result = queryCaptures({ taskId, classification, limit });
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/autoenter/captures — clear the log (after analysis / triage).
router.delete('/captures', async (req, res) => {
  try {
    // ?classification=fire clears the fires log; otherwise the misses log.
    await clearCaptures(req.query.classification);
    res.json({ ok: true, cleared: true });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
