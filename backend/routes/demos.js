// GET /api/demos — list demo apps under frontend/public/.
// Mirrors the read-only shape of routes/projects.js. Auth is applied at the
// parent mount in server.js (requireAuth). The static demo files themselves
// are served by Vite without auth — this route is metadata only.
// See feat-demo-management-001-implement.

const express = require('express');
const { listDemos } = require('../lib/demos');
const { logger } = require('../lib/logger');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const demos = listDemos();
    res.json(demos);
  } catch (error) {
    logger.error({ err: error }, '/api/demos failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
