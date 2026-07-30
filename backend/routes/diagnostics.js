// Client diagnostic events (bug-shell-clipboard-001).
//
// Clipboard failures are invisible server-side: they happen in the browser and
// fail silently by design. "Paste does nothing" looks identical whether the
// cause is a denied permission, a non-secure origin, a shortcut the browser
// swallowed, or an unfocused document — and telling those apart by guesswork
// cost several rounds. The browser now reports what it observed.
//
// Mounted behind requireAuth. Records outcomes and LENGTHS only, never
// clipboard content — see lib/clientDiagnostics.js.

const express = require('express');
const path = require('path');
const { DATA_DIR } = require('../lib/constants');
const { createDiagnosticsLog } = require('../lib/clientDiagnostics');
const { logger } = require('../lib/logger');

const router = express.Router();

const log = createDiagnosticsLog({
  file: path.join(DATA_DIR, 'client-diagnostics.json'),
});

/**
 * @swagger
 * /api/diagnostics/client:
 *   post:
 *     summary: Record a client-side diagnostic event
 *     tags: [Diagnostics]
 */
router.post('/client', (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    // Bounded per request so a runaway client loop cannot flood the log.
    const recorded = events.slice(0, 20).map(e => log.record(e)).filter(Boolean);

    // Mirror into the server log too, so these show up in `docker logs`
    // alongside everything else when someone is watching live.
    for (const e of recorded) {
      logger.info({ diag: e }, 'client diagnostic');
    }
    res.json({ success: true, recorded: recorded.length });
  } catch (error) {
    logger.error({ err: error }, 'diagnostics record failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/diagnostics/client:
 *   get:
 *     summary: Read recent client diagnostic events
 *     tags: [Diagnostics]
 */
router.get('/client', (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 100;
    res.json({
      events: log.list({ limit, category: req.query.category }),
      total: log.size(),
    });
  } catch (error) {
    logger.error({ err: error }, 'diagnostics read failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/client', (req, res) => {
  log.clear();
  res.json({ success: true });
});

module.exports = router;
