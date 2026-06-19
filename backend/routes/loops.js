const express = require('express');
const loops = require('../lib/loops');
const loopManager = require('../lib/loopManager');
const loopAgent = require('../lib/loopAgent');
const loopInstructions = require('../lib/loopInstructions');
const loopPty = require('../lib/loopPty');
const loopActivity = require('../lib/loopActivity');
const github = require('../lib/github');
const { logger } = require('../lib/logger');

const router = express.Router();

/**
 * Loops CRUD API (feat-loops-model-001). Mounted under /api/loops behind
 * requireAuth. Engine/scheduling and hook receiver are separate later phases.
 */

// Map a thrown error to an HTTP response. Validation errors carry status 400 +
// a per-field details object; everything else is a 500 with no internals.
function handleError(res, err, context) {
  if (err && err.status === 400) {
    return res.status(400).json({ error: err.message, details: err.details });
  }
  logger.error({ err }, context || 'Loops request failed');
  return res.status(500).json({ error: 'Internal server error' });
}

/**
 * @swagger
 * /api/loops:
 *   get:
 *     summary: List all GitHub-watcher loops
 *     tags: [Loops]
 *     responses:
 *       200:
 *         description: Array of loop objects
 */
router.get('/', (req, res) => {
  try {
    res.json(loops.list());
  } catch (err) {
    handleError(res, err, 'Failed to list loops');
  }
});

/**
 * @swagger
 * /api/loops/{id}:
 *   get:
 *     summary: Get a single loop by id
 *     tags: [Loops]
 */
router.get('/:id', (req, res) => {
  try {
    const loop = loops.get(req.params.id);
    if (!loop) return res.status(404).json({ error: 'Loop not found' });
    res.json(loop);
  } catch (err) {
    handleError(res, err, 'Failed to get loop');
  }
});

/**
 * @swagger
 * /api/loops:
 *   post:
 *     summary: Create a loop
 *     tags: [Loops]
 */
router.post('/', (req, res) => {
  try {
    const loop = loops.create(req.body || {});
    loopManager.onLoopChanged(loop.id); // schedule the new loop
    res.status(201).json({ success: true, loop });
  } catch (err) {
    handleError(res, err, 'Failed to create loop');
  }
});

/**
 * @swagger
 * /api/loops/{id}/run:
 *   post:
 *     summary: Run a loop's tick immediately (does not affect its schedule)
 *     tags: [Loops]
 */
router.post('/:id/run', async (req, res) => {
  try {
    if (!loops.get(req.params.id)) return res.status(404).json({ error: 'Loop not found' });
    const loop = await loopManager.runLoopNow(req.params.id);
    res.json({ success: true, loop });
  } catch (err) {
    handleError(res, err, 'Failed to run loop');
  }
});

/**
 * @swagger
 * /api/loops/{id}/summarize:
 *   post:
 *     summary: Run an AI summary for a task's PR (manual trigger). Body { task_id?, pr_number? }.
 *     tags: [Loops]
 */
router.post('/:id/summarize', async (req, res) => {
  try {
    const loop = loops.get(req.params.id);
    if (!loop) return res.status(404).json({ error: 'Loop not found' });
    const { task_id = null, pr_number = null } = req.body || {};
    const run = await loopAgent.summarize(loop, { taskId: task_id, prNumber: pr_number, event: 'manual' });
    res.json({ success: run.status !== 'error', run });
  } catch (err) {
    handleError(res, err, 'Failed to summarize');
  }
});

/**
 * @swagger
 * /api/loops/{id}/runs:
 *   get:
 *     summary: List AI-summary run records for a loop (newest first)
 *     tags: [Loops]
 */
router.get('/:id/runs', (req, res) => {
  try {
    if (!loops.get(req.params.id)) return res.status(404).json({ error: 'Loop not found' });
    res.json(loopAgent.listRuns(req.params.id));
  } catch (err) {
    handleError(res, err, 'Failed to list runs');
  }
});

/**
 * @swagger
 * /api/loops/{id}/runs/{runId}:
 *   get:
 *     summary: Get a single run record (full context + output) for review
 *     tags: [Loops]
 */
router.get('/:id/runs/:runId', (req, res) => {
  try {
    const run = loopAgent.getRun(req.params.id, req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  } catch (err) {
    handleError(res, err, 'Failed to get run');
  }
});

/**
 * @swagger
 * /api/loops/{id}:
 *   put:
 *     summary: Update a loop
 *     tags: [Loops]
 */
router.put('/:id', (req, res) => {
  try {
    const loop = loops.update(req.params.id, req.body || {});
    if (!loop) return res.status(404).json({ error: 'Loop not found' });
    loopManager.onLoopChanged(loop.id); // reschedule (interval/enabled may have changed)
    res.json({ success: true, loop });
  } catch (err) {
    handleError(res, err, 'Failed to update loop');
  }
});

/**
 * @swagger
 * /api/loops/{id}:
 *   delete:
 *     summary: Delete a loop
 *     tags: [Loops]
 */
router.delete('/:id', (req, res) => {
  try {
    const removed = loops.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Loop not found' });
    loopManager.onLoopRemoved(req.params.id); // cancel its timer
    res.json({ success: true });
  } catch (err) {
    handleError(res, err, 'Failed to delete loop');
  }
});

/**
 * @swagger
 * /api/loops/{id}/instructions:
 *   get:
 *     summary: Get a loop's generated default + override + effective instructions
 *     tags: [Loops]
 */
router.get('/:id/instructions', (req, res) => {
  try {
    const loop = loops.get(req.params.id);
    if (!loop) return res.status(404).json({ error: 'Loop not found' });
    res.json({
      generated: loopInstructions.generate(loop),
      override: typeof loop.instructions === 'string' ? loop.instructions : null,
      effective: loopInstructions.resolve(loop),
    });
  } catch (err) {
    handleError(res, err, 'Failed to get instructions');
  }
});

/**
 * @swagger
 * /api/loops/{id}/terminal/start:
 *   post:
 *     summary: Start a live PTY agent run (summary of a PR) streamed to the Terminal tab
 *     tags: [Loops]
 */
router.post('/:id/terminal/start', async (req, res) => {
  try {
    const loop = loops.get(req.params.id);
    if (!loop) return res.status(404).json({ error: 'Loop not found' });
    const prNumber = (req.body && req.body.pr_number) || null;
    if (!prNumber) return res.status(400).json({ error: 'pr_number required' });

    const prChanges = await github.getPrChanges(loop.project, prNumber, { refresh: false });
    if (prChanges && prChanges.error) return res.status(502).json({ error: `getPrChanges: ${prChanges.error}` });
    const context = loopAgent.buildContext(loop, { task: null, prNumber, prChanges, event: 'manual', link: null });
    const prompt = loopAgent.buildPrompt(context);

    const runId = loopPty.start(loop, { prompt, label: `summary · PR #${prNumber}` });
    res.json({ success: true, run_id: runId });
  } catch (err) {
    handleError(res, err, 'Failed to start terminal run');
  }
});

/**
 * @swagger
 * /api/loops/{id}/terminal/runs:
 *   get:
 *     summary: List terminal (PTY) runs for a loop, newest first
 *     tags: [Loops]
 */
router.get('/:id/terminal/runs', (req, res) => {
  try {
    if (!loops.get(req.params.id)) return res.status(404).json({ error: 'Loop not found' });
    res.json(loopPty.listRuns(req.params.id));
  } catch (err) {
    handleError(res, err, 'Failed to list terminal runs');
  }
});

/**
 * @swagger
 * /api/loops/{id}/terminal/runs/{runId}/log:
 *   get:
 *     summary: Get the persisted PTY log for a terminal run (for replay)
 *     tags: [Loops]
 */
router.get('/:id/terminal/runs/:runId/log', (req, res) => {
  try {
    const log = loopPty.getLog(req.params.id, req.params.runId);
    if (log == null) return res.status(404).json({ error: 'Log not found' });
    res.json({ run_id: req.params.runId, running: loopPty.isRunning(req.params.runId), log });
  } catch (err) {
    handleError(res, err, 'Failed to get terminal log');
  }
});

/**
 * @swagger
 * /api/loops/{id}/activity:
 *   get:
 *     summary: Per-loop audit trail (what the loop changed), newest first
 *     tags: [Loops]
 */
router.get('/:id/activity', (req, res) => {
  try {
    if (!loops.get(req.params.id)) return res.status(404).json({ error: 'Loop not found' });
    res.json(loopActivity.list(req.params.id));
  } catch (err) {
    handleError(res, err, 'Failed to get activity');
  }
});

module.exports = router;
