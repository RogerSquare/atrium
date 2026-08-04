const express = require('express');
const fs = require('fs');
const path = require('path');
const { TASKS_DIR } = require('../lib/constants');
const { getIO } = require('../lib/io');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { logger } = require('../lib/logger');
const registry = require('../lib/projectRegistry');

const router = express.Router();

/**
 * @swagger
 * /api/projects:
 *   get:
 *     summary: Get all projects with IDs
 *     tags: [Projects]
 *     responses:
 *       200:
 *         description: Array of project objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   folder:
 *                     type: string
 */
router.get('/', (req, res) => {
  try {
    const getDirs = (source) => fs.readdirSync(source, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map(dirent => dirent.name);

    const folders = getDirs(TASKS_DIR);

    // Sync registry with disk (active side only; archived folders live under .archived/)
    registry.syncWithDisk(folders);

    const includeRaw = typeof req.query.include === 'string' ? req.query.include.toLowerCase() : 'active';
    const include = ['active', 'archived', 'all'].includes(includeRaw) ? includeRaw : 'active';

    const all = registry.getAll({ include });
    const projects = Object.entries(all).map(([id, proj]) => ({
      id,
      name: proj.name,
      folder: proj.folder,
      archived: proj.archived === true,
      ...(proj.archived_at ? { archived_at: proj.archived_at } : {}),
    }));

    // Sort: Root first, then alphabetical
    projects.sort((a, b) => {
      if (a.id === 'root') return -1;
      if (b.id === 'root') return 1;
      return a.name.localeCompare(b.name);
    });

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
 *               id:
 *                 type: string
 *                 description: Optional custom short ID (2-12 chars, lowercase alphanumeric + hyphens)
 *                 example: mnp
 *     responses:
 *       201:
 *         description: Project created
 */
router.post('/', (req, res) => {
  try {
    const { name, id: customId } = req.body;
    if (!name || name === 'Root') {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    // Validate custom ID format if provided
    if (customId) {
      if (!/^[a-z0-9][a-z0-9-]{0,11}$/.test(customId)) {
        return res.status(400).json({ error: 'Project ID must be 1-12 lowercase alphanumeric characters or hyphens, starting with a letter or number' });
      }
      if (registry.getById(customId)) {
        return res.status(409).json({ error: `Project ID "${customId}" is already taken` });
      }
    }

    const sanitizedName = name.replace(/[^a-zA-Z0-9-_ ]/g, '-');
    const folderName = sanitizedName.replace(/\s+/g, '-');
    const targetDir = path.join(TASKS_DIR, folderName);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const project = registry.register(folderName, customId);
    if (!project) {
      return res.status(409).json({ error: 'Project ID already taken' });
    }

    // Store the display name if different from folder name (persists to projects.json)
    if (sanitizedName !== folderName) {
      registry.setName(project.id, sanitizedName);
    }

    res.status(201).json({ success: true, project: project.id, name: folderName, id: project.id });
    const io = getIO();
    if (io) io.emit('project_changed');
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/projects/{idOrName}:
 *   delete:
 *     summary: Delete a project and all its tasks
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: idOrName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project deleted
 */
router.delete('/:idOrName', (req, res) => {
  try {
    const { idOrName } = req.params;
    if (!idOrName || idOrName === 'Root' || idOrName === 'root') {
      return res.status(400).json({ error: 'Cannot delete Root project' });
    }

    // Resolve by ID or name
    const project = registry.resolve(idOrName);
    const folder = project ? project.folder : idOrName;

    const safeName = sanitizeFilename(folder);
    const targetDir = safeName ? safePath(TASKS_DIR, safeName) : null;

    if (!targetDir) {
      return res.status(403).json({ error: 'Invalid directory path' });
    }

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // Remove from registry
    if (project && project.id !== 'root') {
      registry.remove(project.id);
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
 * /api/projects/{idOrName}/archive:
 *   post:
 *     summary: Archive a project (soft retire)
 *     description: Physically moves the project folder to tasks/.archived/ and flips archived=true. Idempotent. Root cannot be archived.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: idOrName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project archived (or already archived)
 *       400:
 *         description: Root cannot be archived
 *       404:
 *         description: Project not found
 */
router.post('/:idOrName/archive', (req, res) => {
  try {
    const { idOrName } = req.params;
    if (idOrName === 'Root' || idOrName === 'root') {
      return res.status(400).json({ error: 'Cannot archive Root project' });
    }
    const project = registry.resolve(idOrName);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const updated = registry.archive(project.id);
    if (!updated) return res.status(404).json({ error: 'Project not found' });
    // Physical folder moved; force the task scanner to rescan on next request.
    require('../lib/tasks').invalidateCache();
    res.json({ success: true, project: updated });
    const io = getIO();
    if (io) io.emit('project_changed');
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/projects/{idOrName}/unarchive:
 *   post:
 *     summary: Restore an archived project
 *     description: Moves the folder back from tasks/.archived/ to tasks/ and flips archived=false. Idempotent.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: idOrName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project restored (or already active)
 *       404:
 *         description: Project not found
 */
router.post('/:idOrName/unarchive', (req, res) => {
  try {
    const { idOrName } = req.params;
    if (idOrName === 'Root' || idOrName === 'root') {
      return res.status(400).json({ error: 'Root is never archived' });
    }
    const project = registry.resolve(idOrName);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const updated = registry.unarchive(project.id);
    if (!updated) return res.status(404).json({ error: 'Project not found' });
    require('../lib/tasks').invalidateCache();
    res.json({ success: true, project: updated });
    const io = getIO();
    if (io) io.emit('project_changed');
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/projects/{idOrName}/id:
 *   put:
 *     summary: Update a project's short ID
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: idOrName
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newId]
 *             properties:
 *               newId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Project ID updated
 */
router.put('/:idOrName/id', (req, res) => {
  try {
    const { idOrName } = req.params;
    const { newId } = req.body;

    if (!newId) {
      return res.status(400).json({ error: 'newId is required' });
    }

    if (!/^[a-z0-9][a-z0-9-]{0,11}$/.test(newId)) {
      return res.status(400).json({ error: 'Project ID must be 1-12 lowercase alphanumeric characters or hyphens' });
    }

    const project = registry.resolve(idOrName);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.id === 'root') {
      return res.status(400).json({ error: 'Cannot change Root project ID' });
    }

    const success = registry.updateId(project.id, newId);
    if (!success) {
      return res.status(409).json({ error: `Project ID "${newId}" is already taken` });
    }

    res.json({ success: true, oldId: project.id, newId });
    const io = getIO();
    if (io) io.emit('project_changed');
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/projects/{idOrName}/description:
 *   get:
 *     summary: Get project description (README.md)
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: idOrName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project description content
 */
router.get('/:idOrName/description', (req, res) => {
  try {
    const { idOrName } = req.params;

    // Resolve by ID or name
    const project = registry.resolve(idOrName);
    const folder = project ? project.folder : idOrName;

    const projectDir = folder === 'Root' ? TASKS_DIR : safePath(TASKS_DIR, sanitizeFilename(folder));
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
 * /api/projects/{idOrName}/description:
 *   put:
 *     summary: Update project description (README.md)
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: idOrName
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
// PUT /:idOrName/directory — link (or unlink, with empty body value) the
// project's source folder for the Files view (feat-project-hub-impl-001).
// Path may be absolute or relative to the workspace root; existence is NOT
// required here — resolveProjectDir treats a dangling link as unlinked.
router.put('/:idOrName/directory', (req, res) => {
  try {
    const project = registry.resolve(req.params.idOrName);
    if (!project || !project.id) return res.status(404).json({ error: 'Project not found' });
    const { directory } = req.body || {};
    if (directory !== undefined && directory !== null && typeof directory !== 'string') {
      return res.status(400).json({ error: 'directory must be a string (or null to unlink)' });
    }
    if (typeof directory === 'string' && directory.includes('\0')) {
      return res.status(400).json({ error: 'Invalid directory path' });
    }
    if (!registry.setDirectory(project.id, directory ? directory.trim() : null)) {
      return res.status(400).json({ error: 'Could not update project' });
    }
    res.json({ success: true, id: project.id, directory: directory ? directory.trim() : null });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:idOrName/description', (req, res) => {
  try {
    const { idOrName } = req.params;
    const { content } = req.body;

    const project = registry.resolve(idOrName);
    const folder = project ? project.folder : idOrName;

    const projectDir = folder === 'Root' ? TASKS_DIR : safePath(TASKS_DIR, sanitizeFilename(folder));
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
