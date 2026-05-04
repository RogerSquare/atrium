// GET /api/demos — list demo apps under frontend/public/.
// Mirrors the read-only shape of routes/projects.js. Auth is applied at the
// parent mount in server.js (requireAuth). The static demo files themselves
// are served by Vite without auth — this route is metadata only.
// See feat-demo-management-001-implement.

const express = require('express');
const { listDemos, groupBySservices } = require('../lib/demos');
const { getServicesWithStatus } = require('../lib/services');
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

// GET /api/demos/grouped — same demos, pre-grouped by service.group with
// running/stopped status on each group's service. Demos whose derivable
// project doesn't match any service.group bucket into a trailing
// "Unassigned" group. See feat-demos-services-grouping-001.
router.get('/grouped', async (req, res) => {
  try {
    const [demos, services] = await Promise.all([
      Promise.resolve(listDemos()),
      getServicesWithStatus(),
    ]);
    res.json(groupBySservices(demos, services));
  } catch (error) {
    logger.error({ err: error }, '/api/demos/grouped failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
