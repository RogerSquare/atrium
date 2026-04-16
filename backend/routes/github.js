const express = require('express');
const { TASKS_DIR } = require('../lib/constants');
const { getAllTasks } = require('../lib/tasks');
const { getLinks, clearCache } = require('../lib/github');
const { logger } = require('../lib/logger');
const registry = require('../lib/projectRegistry');

const router = express.Router();

/**
 * @swagger
 * /api/github/links:
 *   get:
 *     summary: Get GitHub branch + PR links for tasks in a project
 *     tags: [GitHub]
 *     parameters:
 *       - in: query
 *         name: project
 *         required: true
 *         schema: { type: string }
 *         description: Project id or folder name
 *       - in: query
 *         name: refresh
 *         schema: { type: string, enum: ['1'] }
 *         description: Bypass the 5-minute cache
 *     responses:
 *       200:
 *         description: Map of task id -> { branch, pr_number, pr_url, pr_state, ... } plus detached lanes
 */
router.get('/links', async (req, res) => {
  try {
    const project = req.query.project;
    if (!project) return res.status(400).json({ error: 'project query param required' });

    const proj = registry.resolve(project);
    if (!proj) return res.status(404).json({ error: 'project not found' });

    const tasks = getAllTasks(TASKS_DIR);
    const taskProjections = tasks
      .filter(t => (t.project || 'Root') === proj.folder && t.id)
      .map(t => ({
        id: t.id,
        // Optional frontmatter overrides — see CLAUDE.md "Branch & PR Linkage"
        github_branch: t.github_branch || null,
        github_pr_url: t.github_pr_url || null,
      }));

    const data = await getLinks(project, taskProjections, { refresh: req.query.refresh === '1' });
    res.json(data);
  } catch (error) {
    logger.error({ err: error }, 'github links request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cache/clear', (req, res) => {
  clearCache();
  res.json({ success: true });
});

module.exports = router;
