// Runner metadata for the UI (ui-tests-tab-generic-001).
//
// GET /api/runners/suites?project=<name>
//   The suites a project DECLARES in its atrium.tests.json. Deliberately
//   distinguishes "no config file" (suites: []) from the runner's built-in
//   default — the Tests tab and the card badge must not claim a project
//   tests when its repo never opted in.

const express = require('express');
const { resolveSuites } = require('../runners');
const { logger } = require('../lib/logger');

const router = express.Router();

router.get('/suites', async (req, res) => {
  const project = typeof req.query.project === 'string' ? req.query.project.trim() : '';
  if (!project || project === 'Root' || project === 'All') {
    return res.json({ project, suites: [], declared: false });
  }
  try {
    // Token-less resolution: with `project` given, resolveSuites never calls
    // the API — it maps workingDirectory/<project> and reads the config file.
    const { suites, configPath } = await resolveSuites({
      api: { token: null },
      taskId: null,
      project,
      log: () => {},
    });
    if (!configPath) return res.json({ project, suites: [], declared: false });
    return res.json({
      project,
      declared: true,
      suites: suites.map((s) => ({
        id: s.id,
        label: s.label,
        report: s.report,
        target: s.target.kind,
      })),
    });
  } catch (err) {
    // An invalid config is a project problem, not a server error — surface it
    // so the Tests tab can show WHY the suites are unusable.
    logger.warn({ err: err.message, project }, 'runners/suites: config resolution failed');
    return res.json({ project, suites: [], declared: false, error: err.message });
  }
});

module.exports = router;
