const express = require('express');
const fs = require('fs');
const { TASKS_DIR, SETTINGS_FILE } = require('../lib/constants');
const { getAllTasks } = require('../lib/tasks');
const {
  getLinks,
  clearCache,
  getPrChanges,
  verifyToken,
  authStatus,
  getLastGhError,
  loadSettings,
} = require('../lib/github');
const { looksLikeToken, tokenHint, SETTINGS_KEY } = require('../lib/githubAuth');
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
    // Surface why PR badges may be absent. Without this the view renders
    // branches and silently omits PRs, which reads as "there are no PRs".
    res.json({ ...data, gh_error: getLastGhError() });
  } catch (error) {
    logger.error({ err: error }, 'github links request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cache/clear', (req, res) => {
  clearCache();
  res.json({ success: true });
});

// --- GitHub sign-in (feat-github-auth-settings-001) -----------------------
//
// Containerized Atrium cannot run `gh auth login` — there is no interactive
// terminal, and ~/.config/gh would be discarded on the next rebuild anyway. So
// the token is stored in settings.json (which lives in the data volume) and
// injected into gh per invocation. These three endpoints are the UI's surface
// onto that; the whole router is mounted behind requireAuth in server.js.

/**
 * @swagger
 * /api/github/auth:
 *   get:
 *     summary: GitHub connection status
 *     tags: [GitHub]
 *     responses:
 *       200:
 *         description: "{ connected, source: 'settings'|'env'|null, login, error }"
 */
router.get('/auth', async (req, res) => {
  try {
    const status = await authStatus();
    const settings = loadSettings();
    res.json({ ...status, hint: tokenHint(settings[SETTINGS_KEY]) });
  } catch (error) {
    logger.error({ err: error }, 'github auth status failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/github/auth:
 *   put:
 *     summary: Store a GitHub personal access token
 *     description: Verifies the token against GitHub before saving. Never returns it.
 *     tags: [GitHub]
 */
router.put('/auth', async (req, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) return res.status(400).json({ error: 'token required' });
    if (!looksLikeToken(token)) {
      return res.status(400).json({ error: 'That does not look like a GitHub token' });
    }

    // Verify BEFORE saving. Storing an unverified token is how you end up back
    // at the original bug: configured-looking state that silently does nothing.
    const result = await verifyToken(token);
    if (!result.ok) return res.status(400).json({ error: result.error });

    const settings = loadSettings();
    settings[SETTINGS_KEY] = token;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));

    // Cached link/PR data was computed while signed out — drop it so the
    // Changes view reflects the new credentials immediately.
    clearCache();

    logger.info({ login: result.login }, 'GitHub token saved');
    res.json({ connected: true, login: result.login, source: 'settings', hint: tokenHint(token) });
  } catch (error) {
    logger.error({ err: error }, 'github auth save failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/github/auth:
 *   delete:
 *     summary: Remove the stored GitHub token
 *     tags: [GitHub]
 */
router.delete('/auth', async (req, res) => {
  try {
    const settings = loadSettings();
    delete settings[SETTINGS_KEY];
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    clearCache();

    // An env-supplied token survives this. Say so rather than reporting a
    // disconnect the user can see is untrue the moment PR badges keep working.
    const status = await authStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    logger.error({ err: error }, 'github auth delete failed');
    res.status(500).json({ error: 'Internal server error' });
  }
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
