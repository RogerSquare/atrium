const express = require('express');
const loops = require('../lib/loops');
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
    res.status(201).json({ success: true, loop });
  } catch (err) {
    handleError(res, err, 'Failed to create loop');
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
    res.json({ success: true });
  } catch (err) {
    handleError(res, err, 'Failed to delete loop');
  }
});

module.exports = router;
