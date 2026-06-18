const express = require('express');
const loops = require('../lib/loops');
const loopManager = require('../lib/loopManager');
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

module.exports = router;
