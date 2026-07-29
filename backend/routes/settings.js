const express = require('express');
const fs = require('fs');
const path = require('path');
const { SETTINGS_FILE, TASKS_DIR, HISTORY_DIR, USERS_DIR, CHAT_DIR, CHAT_FILE } = require('../lib/constants');
const { logger } = require('../lib/logger');
const { redactSettings } = require('../lib/githubAuth');

const router = express.Router();
const serverStartTime = Date.now();

const loadSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch (e) {
    return { workingDirectory: '', agents_enabled: true };
  }
};

// Get dir size recursively
const getDirSize = (dirPath) => {
  let size = 0;
  try {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) size += getDirSize(fullPath);
      else size += stat.size;
    }
  } catch (e) {}
  return size;
};

// Count files recursively
const countFiles = (dirPath, ext) => {
  let count = 0;
  try {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && !item.startsWith('.')) count += countFiles(fullPath, ext);
      else if (!ext || item.endsWith(ext)) count++;
    }
  } catch (e) {}
  return count;
};

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Get system settings
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Current settings
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Settings'
 */
router.get('/', (req, res) => {
  try {
    const settings = loadSettings();
    if (settings.agents_enabled === undefined) settings.agents_enabled = true;
    // The GitHub token lives in settings.json but must never reach the browser
    // — redactSettings swaps it for a github_token_set boolean.
    res.json(redactSettings(settings));
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/settings:
 *   post:
 *     summary: Update system settings
 *     tags: [Settings]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Settings'
 *     responses:
 *       200:
 *         description: Settings updated
 */
router.post('/', (req, res) => {
  try {
    const current = loadSettings();
    const { workingDirectory, agents_enabled, ai_chat_enabled, default_priority, default_type } = req.body;
    if (workingDirectory !== undefined) current.workingDirectory = workingDirectory;
    if (agents_enabled !== undefined) current.agents_enabled = agents_enabled;
    if (ai_chat_enabled !== undefined) current.ai_chat_enabled = ai_chat_enabled;
    if (default_priority !== undefined) current.default_priority = default_priority;
    if (default_type !== undefined) current.default_type = default_type;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(current, null, 2));
    // Same redaction as GET — this response echoes the saved settings back.
    // The token is set through PUT /api/github/auth, never through here.
    res.json({ success: true, settings: redactSettings(current) });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// About / system status
/**
 * @swagger
 * /api/settings/status:
 *   get:
 *     summary: Get system status
 *     description: Returns version, uptime, task/project/user counts, and storage sizes.
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: System status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SystemStatus'
 */
router.get('/status', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    const userCount = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json')).length;
    const taskCount = countFiles(TASKS_DIR, '.md');
    const projectDirs = fs.readdirSync(TASKS_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).length;
    const historyCount = fs.existsSync(HISTORY_DIR) ? fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.md')).length : 0;

    const uptimeMs = Date.now() - serverStartTime;
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);

    res.json({
      version: pkg.version || '1.0.0',
      name: pkg.name || 'atrium',
      node_version: process.version,
      uptime: `${hours}h ${minutes}m`,
      uptime_ms: uptimeMs,
      counts: {
        tasks: taskCount,
        projects: projectDirs,
        users: userCount,
        history_backups: historyCount
      },
      storage: {
        tasks: getDirSize(TASKS_DIR),
        history: fs.existsSync(HISTORY_DIR) ? getDirSize(HISTORY_DIR) : 0,
        chat: fs.existsSync(CHAT_FILE) ? fs.statSync(CHAT_FILE).size : 0,
        users: getDirSize(USERS_DIR)
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export all tasks as JSON
/**
 * @swagger
 * /api/settings/export:
 *   get:
 *     summary: Export all tasks as JSON
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: JSON file download
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Task'
 */
router.get('/export', (req, res) => {
  try {
    const { getAllTasks } = require('../lib/tasks');
    const tasks = getAllTasks(TASKS_DIR);
    const safeTasks = tasks.map(({ filePath, ...rest }) => rest);
    res.setHeader('Content-Disposition', 'attachment; filename=tasks-export.json');
    res.json(safeTasks);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear chat history
/**
 * @swagger
 * /api/settings/chat-history:
 *   delete:
 *     summary: Clear all chat history
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Chat history cleared
 */
router.delete('/chat-history', (req, res) => {
  try {
    fs.writeFileSync(CHAT_FILE, JSON.stringify([]));
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Purge old history backups
/**
 * @swagger
 * /api/settings/history:
 *   delete:
 *     summary: Purge old task history backups
 *     tags: [Settings]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Delete backups older than this many days
 *     responses:
 *       200:
 *         description: Backups purged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 deleted:
 *                   type: integer
 */
router.delete('/history', (req, res) => {
  try {
    if (!fs.existsSync(HISTORY_DIR)) return res.json({ success: true, deleted: 0 });

    const maxAge = parseInt(req.query.days || '30') * 86400000;
    const now = Date.now();
    const files = fs.readdirSync(HISTORY_DIR);
    let deleted = 0;

    for (const f of files) {
      const fullPath = path.join(HISTORY_DIR, f);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(fullPath);
        deleted++;
      }
    }

    res.json({ success: true, deleted });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
