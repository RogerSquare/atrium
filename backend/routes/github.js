const express = require('express');
const { TASKS_DIR } = require('../lib/constants');
const { getAllTasks } = require('../lib/tasks');
const { getLinks, clearCache, getPrChanges } = require('../lib/github');
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

/**
 * @swagger
 * /api/github/changes:
 *   get:
 *     summary: Get commits + files + diff stats for a task's PR
 *     tags: [GitHub]
 *     parameters:
 *       - in: query
 *         name: project
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: task
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: refresh
 *         schema: { type: string, enum: ['1'] }
 *     responses:
 *       200:
 *         description: PR changes payload (empty when task has no linked PR)
 */
router.get('/changes', async (req, res) => {
  try {
    const project = req.query.project;
    const taskId = req.query.task;
    if (!project || !taskId) {
      return res.status(400).json({ error: 'project and task query params required' });
    }

    const proj = registry.resolve(project);
    if (!proj) return res.status(404).json({ error: 'project not found' });

    // Reuse the links lookup to find the PR number for this task — handles
    // frontmatter overrides, substring branch matching, and orphan PRs
    // exactly the same way the Changes view does.
    const tasks = getAllTasks(TASKS_DIR);
    const taskProjections = tasks
      .filter(t => (t.project || 'Root') === proj.folder && t.id)
      .map(t => ({
        id: t.id,
        github_branch: t.github_branch || null,
        github_pr_url: t.github_pr_url || null,
      }));
    const links = await getLinks(project, taskProjections, { refresh: false });
    const link = links.by_task_id?.[taskId];
    if (!link || !link.pr_number) {
      return res.json({ pr_number: null, commits: [], files: [], additions: 0, deletions: 0, changed_files: 0 });
    }

    const data = await getPrChanges(project, link.pr_number, { refresh: req.query.refresh === '1' });
    if (data && data.error) {
      return res.status(502).json({ error: data.error });
    }
    res.json(data);
  } catch (error) {
    logger.error({ err: error }, 'github changes request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
