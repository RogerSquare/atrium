const express = require('express');
const fs = require('fs');
const path = require('path');
const { TASKS_DIR } = require('../lib/constants');
const { getIO } = require('../lib/io');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { logger } = require('../lib/logger');

const router = express.Router();

/**
 * @swagger
 * /api/projects:
 *   get:
 *     summary: Get all projects
 *     tags: [Projects]
 *     responses:
 *       200:
 *         description: Array of project names
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Root", "Agent-Task-Board"]
 */
router.get('/', (req, res) => {
  try {
    const getDirs = (source) => fs.readdirSync(source, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map(dirent => dirent.name);

    const projects = ['Root', ...getDirs(TASKS_DIR)];
    res.json(projects);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/projects:
 *   post:
 *     summary: Create a project
 *     tags: [Projects]
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
 *                 example: My-New-Project
 *     responses:
 *       201:
 *         description: Project created
 */
router.post('/', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || name === 'Root') {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    const sanitizedName = name.replace(/[^a-zA-Z0-9-_]/g, '-');
    const targetDir = path.join(TASKS_DIR, sanitizedName);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    res.status(201).json({ success: true, project: sanitizedName });
    const io = getIO();
    if (io) io.emit('project_changed');
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/projects/{name}:
 *   delete:
 *     summary: Delete a project and all its tasks
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project deleted
 */
router.delete('/:name', (req, res) => {
  try {
    const { name } = req.params;
    if (!name || name === 'Root') {
      return res.status(400).json({ error: 'Cannot delete Root project' });
    }

    const safeName = sanitizeFilename(name);
    const targetDir = safeName ? safePath(TASKS_DIR, safeName) : null;

    if (!targetDir) {
      return res.status(403).json({ error: 'Invalid directory path' });
    }

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    res.json({ success: true });
    const io = getIO();
    if (io) io.emit('project_changed');
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/projects/{name}/description:
 *   get:
 *     summary: Get project description (README.md)
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project description content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 content:
 *                   type: string
 */
router.get('/:name/description', (req, res) => {
  try {
    const { name } = req.params;
    const projectDir = name === 'Root' ? TASKS_DIR : safePath(TASKS_DIR, sanitizeFilename(name));
    if (!projectDir) return res.status(400).json({ error: 'Invalid project name' });
    const readmePath = path.join(projectDir, 'README.md');

    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf8');
      res.json({ content });
    } else {
      res.json({ content: '' });
    }
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/projects/{name}/description:
 *   put:
 *     summary: Update project description (README.md)
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Description updated
 */
router.put('/:name/description', (req, res) => {
  try {
    const { name } = req.params;
    const { content } = req.body;
    const projectDir = name === 'Root' ? TASKS_DIR : safePath(TASKS_DIR, sanitizeFilename(name));
    if (!projectDir) return res.status(400).json({ error: 'Invalid project name' });
    const readmePath = path.join(projectDir, 'README.md');

    if (!fs.existsSync(projectDir)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    fs.writeFileSync(readmePath, content, 'utf8');
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
