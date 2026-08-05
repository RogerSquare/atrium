const express = require('express');
const { getIO } = require('../lib/io');
const { logger } = require('../lib/logger');
const workspaces = require('../lib/workspaceRegistry');

// Workspaces (feat-workspaces-impl-001): the isolation layer above projects.
// Mounted with requireAuth in server.js. Mutations emit `project_changed` —
// clients already refetch projects on that event, and workspace changes only
// matter to a client through the project list it renders.

const router = express.Router();

const emitChanged = () => {
  const io = getIO();
  if (io) io.emit('project_changed');
};

/**
 * @swagger
 * /api/workspaces:
 *   get:
 *     summary: List workspaces (sorted by order, then name)
 *     tags: [Workspaces]
 *     responses:
 *       200:
 *         description: Array of workspace objects ({id, name, order, color?})
 */
router.get('/', (req, res) => {
  try {
    res.json(workspaces.getAll());
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/workspaces:
 *   post:
 *     summary: Create a workspace
 *     tags: [Workspaces]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: Workspace created
 *       400:
 *         description: Missing/empty name
 *       409:
 *         description: Name already taken
 */
router.post('/', (req, res) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Workspace name is required' });
    }
    const created = workspaces.create(name);
    if (!created) {
      return res.status(409).json({ error: `A workspace named "${name.trim()}" already exists` });
    }
    res.status(201).json({ success: true, workspace: created });
    emitChanged();
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/workspaces/{id}:
 *   put:
 *     summary: Update a workspace (rename, color, order)
 *     tags: [Workspaces]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               color:
 *                 type: string
 *                 nullable: true
 *               order:
 *                 type: number
 *     responses:
 *       200:
 *         description: Workspace updated
 *       404:
 *         description: Workspace not found
 *       409:
 *         description: New name already taken
 */
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, order } = req.body || {};
    if (!workspaces.getById(id)) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    if (name === undefined && color === undefined && order === undefined) {
      return res.status(400).json({ error: 'Nothing to update — provide name, color, or order' });
    }
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Workspace name cannot be empty' });
      }
      if (!workspaces.rename(id, name)) {
        return res.status(409).json({ error: `A workspace named "${name.trim()}" already exists` });
      }
    }
    if (color !== undefined) {
      if (color !== null && typeof color !== 'string') {
        return res.status(400).json({ error: 'color must be a string or null' });
      }
      workspaces.setColor(id, color);
    }
    if (order !== undefined) {
      if (!workspaces.setOrder(id, order)) {
        return res.status(400).json({ error: 'order must be a finite number' });
      }
    }
    res.json({ success: true, workspace: workspaces.getById(id) });
    emitChanged();
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/workspaces/{id}:
 *   delete:
 *     summary: Delete an empty, non-default workspace
 *     tags: [Workspaces]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Workspace deleted
 *       400:
 *         description: Default workspace, or workspace still has projects
 *       404:
 *         description: Workspace not found
 */
router.delete('/:id', (req, res) => {
  try {
    const result = workspaces.remove(req.params.id);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      if (result.reason === 'default') {
        return res.status(400).json({ error: 'Cannot delete the default workspace' });
      }
      // in_use: never cascades — moving projects out is an explicit user act.
      return res.status(400).json({
        error: `Workspace still has ${result.count} project${result.count === 1 ? '' : 's'} — move them first`,
        count: result.count,
      });
    }
    res.json({ success: true });
    emitChanged();
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
