const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const matter = require('gray-matter');
const { TASKS_DIR, HISTORY_DIR, TRASH_DIR } = require('../lib/constants');
const { getAllTasks, findTaskFilePath, indexSet, indexDelete, atomicWriteFileSync, trimActivityLog, getFullActivityLog, generateSummary } = require('../lib/tasks');
const { withLock } = require('../lib/lock');
const { getIO } = require('../lib/io');
const taskWaiters = require('../lib/taskWaiters');
const { validateReviewLinkage } = require('../lib/branchValidator');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { logger } = require('../lib/logger');

const router = express.Router();

// Attach a fresh summary to a task object before emitting / responding.
const withSummary = (task) => ({ ...task, summary: generateSummary(task) });

/**
 * @swagger
 * /api/tasks:
 *   get:
 *     summary: Get all tasks
 *     tags: [Tasks]
 *     responses:
 *       200:
 *         description: Array of all tasks
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Task'
 */
// GET /api/tasks/templates — list available task templates
router.get('/templates', (req, res) => {
  try {
    const templatesDir = path.join(__dirname, '..', 'templates');
    if (!fs.existsSync(templatesDir)) return res.json({ templates: [] });
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
    const templates = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf-8'));
      return { id: f.replace('.json', ''), ...data };
    });
    res.json({ templates });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/from-template/:templateId — create task from template with overrides
router.post('/from-template/:templateId', (req, res) => {
  try {
    const templatePath = path.join(__dirname, '..', 'templates', `${req.params.templateId}.json`);
    if (!fs.existsSync(templatePath)) return res.status(404).json({ error: 'Template not found' });

    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
    const merged = { ...template.defaults, ...req.body };

    // Forward to the main create handler by setting req.body and calling next
    req.body = merged;
    req.url = '/';
    req.method = 'POST';

    // Use the router to handle it
    const { title, status = 'todo', priority, content, project = 'Root', type, component = null, tags = [], parent_task = null, depends_on = [], due_date = null, id, created_by } = merged;
    const rawId = id || `task-${Date.now()}`;
    const taskId = sanitizeFilename(rawId) || `task-${Date.now()}`;
    const safeProject = project === 'Root' ? 'Root' : sanitizeFilename(project);
    const targetDir = safeProject === 'Root' ? TASKS_DIR : safePath(TASKS_DIR, safeProject);

    if (!targetDir) return res.status(400).json({ error: 'Invalid project name' });
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const filePath = safePath(targetDir, `${taskId}.md`);
    if (!filePath) return res.status(400).json({ error: 'Invalid task ID' });
    if (fs.existsSync(filePath)) return res.status(409).json({ error: 'Task ID already exists' });

    const now = new Date().toISOString();
    const creator = created_by || 'Unknown User';
    const data = {
      id: taskId, title: title || `New ${template.name}`, status, priority: priority || template.defaults.priority || 'medium',
      type: type || template.defaults.type || 'fullstack', component, tags: tags.length ? tags : (template.defaults.tags || []),
      parent_task, depends_on, due_date, created_at: now,
      activity_log: [{ timestamp: now, action: `Task created from template '${req.params.templateId}' by ${creator}` }]
    };
    Object.keys(data).forEach(key => { if (data[key] === undefined || data[key] === null || data[key] === '') delete data[key]; });

    const fileContent = matter.stringify(content || template.defaults.content || '', data);
    atomicWriteFileSync(filePath, fileContent);
    indexSet(taskId, filePath);

    const createdTask = { id: taskId, ...data, content: content || template.defaults.content || '', project: safeProject, template: req.params.templateId };
    res.status(201).json({ success: true, task: createdTask });
    const io = getIO();
    if (io) io.emit('task_created', withSummary(createdTask));
    taskWaiters.notify(createdTask);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/search?q=keyword — full-text search across title, content, tags, id
router.get('/search', (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.status(400).json({ error: 'q parameter required' });

    const projectQuery = req.query.project || req.query.project_id;
    const tasks = getAllTasks(TASKS_DIR);

    // Resolve project_id to folder name if needed
    let projectFilter = projectQuery;
    if (req.query.project_id) {
      const projectRegistry = require('../lib/projectRegistry');
      const proj = projectRegistry.resolve(req.query.project_id);
      if (proj) projectFilter = proj.folder;
    }

    const results = tasks.filter(t => {
      if (projectFilter && t.project !== projectFilter) return false;
      const searchable = [
        t.id, t.title, t.content, t.component,
        ...(t.tags || []),
        t.assignee, t.type
      ].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(q);
    }).map(({ filePath, ...rest }) => rest);

    res.json({ query: q, total: results.length, tasks: results });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/stale — find tasks that need attention
router.get('/stale', (req, res) => {
  try {
    const status = req.query.status; // filter by status
    const olderThanDays = parseInt(req.query.older_than) || 7;
    const noContent = req.query.no_content === 'true';

    const tasks = getAllTasks(TASKS_DIR);
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

    const stale = tasks.filter(t => {
      if (status && t.status !== status) return false;
      if (noContent) return !t.content || !t.content.trim();

      // Check last activity
      const log = t.activity_log || [];
      const lastActivity = log.length > 0 ? log[log.length - 1].timestamp : t.created_at;
      return lastActivity && lastActivity < cutoff;
    }).map(({ filePath, ...rest }) => rest);

    res.json({ count: stale.length, older_than_days: olderThanDays, tasks: stale });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/incomplete — find tasks with empty content or missing fields
router.get('/incomplete', (req, res) => {
  try {
    const tasks = getAllTasks(TASKS_DIR);
    const incomplete = tasks.filter(t => !t.content || !t.content.trim()).map(({ filePath, ...rest }) => rest);
    res.json({ count: incomplete.length, tasks: incomplete });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', (req, res) => {
  try {
    let tasks = getAllTasks(TASKS_DIR);
    let safeTasks = tasks.map(({ filePath, ...rest }) => rest);

    const projectRegistry = require('../lib/projectRegistry');

    // Filter by project if specified (supports both project name and project_id)
    if (req.query.project || req.query.project_id) {
      let projectFilter = req.query.project;
      if (req.query.project_id) {
        const proj = projectRegistry.resolve(req.query.project_id);
        if (proj) projectFilter = proj.folder;
      }
      if (projectFilter) {
        safeTasks = safeTasks.filter(t => t.project === projectFilter);
      }
    }

    // Agent contract: tasks in archived projects are hidden by default.
    // Pass ?include=archived or ?include=all to opt in (used by the UI's archived view).
    const includeRaw = typeof req.query.include === 'string' ? req.query.include.toLowerCase() : 'active';
    if (includeRaw !== 'archived' && includeRaw !== 'all') {
      const archivedFolders = new Set(
        Object.values(projectRegistry.getAll({ include: 'archived' })).map(p => p.folder)
      );
      if (archivedFolders.size > 0) {
        safeTasks = safeTasks.filter(t => !archivedFolders.has(t.project));
      }
    }

    // Sort support: ?sort=created_at&order=desc
    const sortField = req.query.sort;
    if (sortField) {
      const order = req.query.order === 'asc' ? 1 : -1;
      safeTasks.sort((a, b) => {
        const aVal = a[sortField] || '';
        const bVal = b[sortField] || '';
        return aVal < bVal ? -order : aVal > bVal ? order : 0;
      });
    }

    // Pagination: ?limit=100&offset=0
    // If no limit specified, return plain array (backwards compatible)
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit) || 100, 500) : null;
    let responseBody;
    if (limit !== null) {
      const offset = parseInt(req.query.offset) || 0;
      const total = safeTasks.length;
      const page = safeTasks.slice(offset, offset + limit);
      responseBody = { total, offset, limit, tasks: page };
    } else {
      responseBody = safeTasks;
    }

    // ETag and Cache-Control
    const json = JSON.stringify(responseBody);
    const etag = `"${crypto.createHash('md5').update(json).digest('hex')}"`;
    res.set('Cache-Control', 'private, max-age=5');
    res.set('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.json(responseBody);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks/batch:
 *   put:
 *     summary: Batch update multiple tasks
 *     description: Apply the same updates to multiple tasks at once. Each task is updated individually with activity logging.
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids, updates]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["feat-auth-001", "feat-auth-002"]
 *               updates:
 *                 type: object
 *                 properties:
 *                   status:
 *                     type: string
 *                   priority:
 *                     type: string
 *                   assignee:
 *                     type: string
 *               updated_by:
 *                 type: string
 *     responses:
 *       200:
 *         description: Batch update results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 updated:
 *                   type: integer
 *                 failed:
 *                   type: integer
 */
router.put('/batch', async (req, res) => {
  try {
    const { ids, updates, updated_by } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !updates) {
      return res.status(400).json({ error: 'ids (array) and updates (object) are required' });
    }

    if (ids.length > 200) {
      return res.status(400).json({ error: 'Maximum 200 tasks per batch' });
    }

    let updated = 0;
    let failed = 0;
    const io = getIO();

    for (const id of ids) {
      try {
        await withLock(`task:${id}`, async () => {
          let filePath = findTaskFilePath(id);
          if (!filePath || !fs.existsSync(filePath)) {
            failed++;
            return;
          }

          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const parsed = matter(fileContent);
          const currentData = parsed.data;
          const currentContent = parsed.content;

          const now = new Date().toISOString();
          const actor = updated_by || currentData.assignee || 'Agent';

          // Build new data
          const newData = { ...currentData };
          const changeDetails = [];

          if (updates.status !== undefined && updates.status !== currentData.status) {
            newData.status = updates.status;
            if (updates.status === 'in_progress' && !newData.started_at) newData.started_at = now;
            if (updates.status === 'review' && !newData.reviewed_at) newData.reviewed_at = now;
            if (updates.status === 'done' && !newData.done_at) newData.done_at = now;
            changeDetails.push(`Status changed to ${updates.status.toUpperCase()}`);
          }

          if (updates.priority !== undefined && updates.priority !== currentData.priority) {
            newData.priority = updates.priority;
            changeDetails.push(`priority changed from ${currentData.priority || 'none'} to ${updates.priority}`);
          }

          if (updates.assignee !== undefined && updates.assignee !== currentData.assignee) {
            newData.assignee = updates.assignee;
            changeDetails.push(`assignee changed from ${currentData.assignee || 'none'} to ${updates.assignee || 'none'}`);
          }

          if (changeDetails.length === 0) {
            return; // nothing to change
          }

          newData.activity_log = newData.activity_log || [];
          changeDetails.forEach(detail => {
            newData.activity_log.push({ timestamp: now, action: `${detail} by ${actor} (batch)` });
          });

          trimActivityLog(id, newData);
          const newFileContent = matter.stringify(currentContent, newData);
          atomicWriteFileSync(filePath, newFileContent);
          indexSet(id, filePath);

          const relativePath = path.relative(TASKS_DIR, path.dirname(filePath));
          const updatedTask = { ...newData, content: currentContent.trim(), project: relativePath || 'Root' };
          if (io) io.emit('task_updated', withSummary(updatedTask));
          taskWaiters.notify(updatedTask);
          updated++;
        });
      } catch (err) {
        logger.error({ err, taskId: id }, 'Batch update failed for task');
        failed++;
      }
    }

    res.json({ success: true, updated, failed });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks/batch:
 *   delete:
 *     summary: Batch delete multiple tasks
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids]
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Batch delete results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 deleted:
 *                   type: integer
 *                 failed:
 *                   type: integer
 */
router.delete('/batch', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids (array) is required' });
    }

    if (ids.length > 200) {
      return res.status(400).json({ error: 'Maximum 200 tasks per batch' });
    }

    let deleted = 0;
    let failed = 0;
    const io = getIO();

    const permanent = req.query.permanent === 'true';
    if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });

    for (const id of ids) {
      try {
        await withLock(`task:${id}`, async () => {
          const filePath = findTaskFilePath(id);
          if (filePath && fs.existsSync(filePath)) {
            if (permanent) {
              fs.unlinkSync(filePath);
            } else {
              const fileContent = fs.readFileSync(filePath, 'utf-8');
              const parsed = matter(fileContent);
              parsed.data.deleted_at = new Date().toISOString();
              parsed.data.deleted_from = path.relative(TASKS_DIR, path.dirname(filePath)) || 'Root';
              const trashPath = path.join(TRASH_DIR, `${id}.md`);
              fs.writeFileSync(trashPath, matter.stringify(parsed.content, parsed.data));
              fs.unlinkSync(filePath);
            }
            indexDelete(id);
            if (io) io.emit('task_deleted', { id });
            deleted++;
          } else {
            failed++;
          }
        });
      } catch (err) {
        logger.error({ err, taskId: id }, 'Batch delete failed for task');
        failed++;
      }
    }

    res.json({ success: true, deleted, failed });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Trash endpoints (must be before /:id routes) ---

// GET /api/tasks/trash — list trashed tasks
router.get('/trash', (req, res) => {
  try {
    if (!fs.existsSync(TRASH_DIR)) return res.json([]);
    const files = fs.readdirSync(TRASH_DIR).filter(f => f.endsWith('.md'));
    const tasks = files.map(f => {
      const filePath = path.join(TRASH_DIR, f);
      const { data, content } = matter(fs.readFileSync(filePath, 'utf-8'));
      return { ...data, content: content.trim(), id: data.id || f.replace('.md', '') };
    });
    res.json(tasks);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tasks/trash/purge?days=30 — permanently delete old trashed tasks
router.delete('/trash/purge', (req, res) => {
  try {
    if (!fs.existsSync(TRASH_DIR)) return res.json({ success: true, purged: 0 });
    const days = parseInt(req.query.days) || 30;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(TRASH_DIR).filter(f => f.endsWith('.md'));
    let purged = 0;

    for (const f of files) {
      const filePath = path.join(TRASH_DIR, f);
      try {
        const { data } = matter(fs.readFileSync(filePath, 'utf-8'));
        if (data.deleted_at && new Date(data.deleted_at).getTime() < cutoff) {
          fs.unlinkSync(filePath);
          purged++;
        }
      } catch (e) { /* skip unparseable files */ }
    }

    res.json({ success: true, purged });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks/{id}:
 *   get:
 *     summary: Get a single task with full metadata
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task object with frontmatter, content, project, and summary
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         description: Task not found
 */
// GET /api/tasks/wait-for-next-todo — long-poll for the next task promoted to `todo`.
// Returns { task, claimed: true } when a matching task appears (task is atomically claimed:
// status -> in_progress, assignee -> caller). Returns { task: null, timeout: true } if the
// server-side timeout elapses. Client should re-call to keep watching.
//
// Timeout cap: default 270s per request, hard-capped by ATRIUM_WAIT_MAX_SECONDS env var
// (default 300s). See backend/docs/mcp-long-poll-empirical.md for rationale.
//
// This route MUST be registered before '/:id' so the literal path wins.
const WAIT_MAX_SECONDS = parseInt(process.env.ATRIUM_WAIT_MAX_SECONDS || '300', 10);

router.get('/wait-for-next-todo', async (req, res) => {
  const requestedTimeout = parseInt(req.query.timeout_seconds || '270', 10);
  const timeoutMs = Math.min(Math.max(requestedTimeout, 1), WAIT_MAX_SECONDS) * 1000;
  const filter = {
    status: 'todo',
    assignee: req.query.assignee || (req.user && req.user.username),
    project: req.query.project,
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const onClose = () => { clearTimeout(timeoutHandle); controller.abort(); };
  req.on('close', onClose);

  try {
    const task = await taskWaiters.register(filter, controller.signal);
    clearTimeout(timeoutHandle);
    req.removeListener('close', onClose);
    // Atomic claim: re-read + update task under withLock. If status has changed from todo
    // (race with another waiter or human), return the task as-is and let the client decide.
    const claimed = await claimTaskForWait(task.id, filter.assignee).catch(err => ({ error: err.message, task }));
    if (claimed && claimed.error) {
      return res.json({ task: claimed.task, claimed: false, note: `claim-failed: ${claimed.error}` });
    }
    return res.json({ task: claimed, claimed: true });
  } catch (err) {
    clearTimeout(timeoutHandle);
    req.removeListener('close', onClose);
    if (err.message === 'aborted') {
      return res.json({ task: null, timeout: true });
    }
    logger.error({ err }, 'wait-for-next-todo failed');
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Helper: atomically claim a task for an agent. Reads the task under withLock,
// verifies status is still `todo`, updates status -> in_progress + assignee + timestamps,
// writes atomically, returns the updated task. Throws if the task has moved on.
async function claimTaskForWait(id, assignee) {
  const filePath = findTaskFilePath(id);
  if (!filePath) throw new Error(`task not found: ${id}`);
  return await withLock(filePath, () => {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(raw);
    if (parsed.data.status !== 'todo') {
      throw new Error(`race: task ${id} no longer in todo (status=${parsed.data.status})`);
    }
    const now = new Date().toISOString();
    parsed.data.status = 'in_progress';
    parsed.data.assignee = assignee;
    parsed.data.started_at = parsed.data.started_at || now;
    parsed.data.activity_log = (parsed.data.activity_log || []).concat([
      { timestamp: now, action: `Status changed to IN PROGRESS by ${assignee}` },
      { timestamp: now, action: `assignee changed to ${assignee} (auto-claim by wait-for-next-todo)` },
    ]);
    trimActivityLog(id, parsed.data);
    const updatedContent = matter.stringify(parsed.content, parsed.data);
    atomicWriteFileSync(filePath, updatedContent);
    const relativePath = path.relative(TASKS_DIR, path.dirname(filePath));
    const updatedTask = { ...parsed.data, content: parsed.content, project: relativePath || 'Root' };
    const io = getIO();
    if (io) io.emit('task_updated', withSummary(updatedTask));
    taskWaiters.notify(updatedTask);
    return updatedTask;
  });
}

router.get('/:id', (req, res) => {
  const { id } = req.params;
  try {
    const filePath = findTaskFilePath(id);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(fileContent);
    const relativePath = path.relative(TASKS_DIR, path.dirname(filePath));
    const project = relativePath || 'Root';
    const task = {
      id: data.id || id,
      title: data.title || 'Untitled',
      status: data.status || 'todo',
      priority: data.priority || 'medium',
      assignee: data.assignee || null,
      type: data.type || 'fullstack',
      component: data.component || null,
      tags: data.tags || [],
      files_affected: data.files_affected || [],
      parent_task: data.parent_task || null,
      depends_on: data.depends_on || [],
      due_date: data.due_date || null,
      created_at: data.created_at || null,
      started_at: data.started_at || null,
      reviewed_at: data.reviewed_at || null,
      done_at: data.done_at || null,
      activity_log: data.activity_log || [],
      project,
      content: content.trim()
    };
    res.json(withSummary(task));
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks/{id}:
 *   put:
 *     summary: Update a task
 *     description: Updates any task fields. Auto-timestamps status changes (started_at, reviewed_at, done_at). Creates activity log entries. Moves task between projects if project field changes. Creates a backup before each update.
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: feat-auth-001
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [todo, in_progress, review, done]
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *               content:
 *                 type: string
 *               project:
 *                 type: string
 *               assignee:
 *                 type: string
 *                 nullable: true
 *               type:
 *                 type: string
 *               component:
 *                 type: string
 *                 nullable: true
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               files_affected:
 *                 type: array
 *                 items:
 *                   type: string
 *               parent_task:
 *                 type: string
 *                 nullable: true
 *               updated_by:
 *                 type: string
 *     responses:
 *       200:
 *         description: Task updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 task:
 *                   $ref: '#/components/schemas/Task'
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await withLock(`task:${id}`, async () => {
    const { title, status, priority, content, project, assignee, type, component, tags, files_affected, parent_task, depends_on, due_date, updated_by, github_branch, github_pr_url, claude_session_id } = req.body;

    let filePath = findTaskFilePath(id);
    let originalProject = '';

    if (filePath) {
      const relativePath = path.relative(TASKS_DIR, path.dirname(filePath));
      originalProject = relativePath || 'Root';
    }

    if (!filePath) {
      filePath = path.join(TASKS_DIR, `${id}.md`);
    }

    // Agent contract: tasks in archived projects are frozen — no updates.
    // Also blocks transitioning a task INTO an archived project via the `project` field.
    const projectRegistry = require('../lib/projectRegistry');
    if (originalProject && originalProject !== 'Root') {
      const origProj = projectRegistry.resolve(originalProject);
      if (origProj && origProj.archived === true) {
        return res.status(403).json({ error: 'Project is archived; cannot update tasks here' });
      }
    }
    if (project && project !== 'Root' && project !== originalProject) {
      const targetProj = projectRegistry.resolve(project);
      if (targetProj && targetProj.archived === true) {
        return res.status(403).json({ error: 'Target project is archived; cannot move tasks into it' });
      }
    }

    let currentData = { id };
    let currentContent = '';

    if (fs.existsSync(filePath)) {
      const currentFileContent = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(currentFileContent);
      currentData = parsed.data;
      currentContent = parsed.content;
    }

    const newData = {
      id: id,
      title: title !== undefined ? title : (currentData.title || 'Untitled'),
      status: status !== undefined ? status : (currentData.status || 'todo'),
      priority: priority !== undefined ? priority : (currentData.priority || 'medium'),
      assignee: assignee !== undefined ? assignee : (currentData.assignee || null),
      type: type !== undefined ? type : (currentData.type || 'fullstack'),
      component: component !== undefined ? component : (currentData.component || null),
      tags: tags !== undefined ? tags : (currentData.tags || []),
      files_affected: files_affected !== undefined ? files_affected : (currentData.files_affected || []),
      parent_task: parent_task !== undefined ? parent_task : (currentData.parent_task || null),
      depends_on: depends_on !== undefined ? depends_on : (currentData.depends_on || []),
      due_date: due_date !== undefined ? due_date : (currentData.due_date || null),
      // Optional Changes-view overrides — see CLAUDE.md "Branch & PR Linkage → Explicit override"
      github_branch: github_branch !== undefined ? github_branch : (currentData.github_branch || null),
      github_pr_url: github_pr_url !== undefined ? github_pr_url : (currentData.github_pr_url || null),
      // Per-task claude session UUID — minted on first Shell-tab spawn,
      // rotated on Start New Session. Round-trips through MCP for recovery
      // scripts that need to re-link a task to a known-good session id.
      claude_session_id: claude_session_id !== undefined ? claude_session_id : (currentData.claude_session_id || null),
      created_at: currentData.created_at || new Date().toISOString(),
      started_at: currentData.started_at || null,
      reviewed_at: currentData.reviewed_at || null,
      done_at: currentData.done_at || null,
      activity_log: currentData.activity_log || []
    };

    // Enforce Changes-view linkage on review transitions (opt-review-branch-validation-001).
    // Pure function, returns null or an error object. Early-return on failure.
    const linkageError = validateReviewLinkage(newData, currentData.status);
    if (linkageError) {
      return res.status(400).json(linkageError);
    }

    const now = new Date().toISOString();
    const actor = updated_by || newData.assignee || 'Agent';

    // Backup current file before update
    if (fs.existsSync(filePath)) {
      try {
        const lastActorEntry = currentData.activity_log && currentData.activity_log.length > 0
          ? currentData.activity_log[currentData.activity_log.length - 1].action
          : '';
        const lastActor = lastActorEntry.includes(' by ') ? lastActorEntry.split(' by ').pop() : 'Unknown';
        const backupFilename = `${id}.${Date.now()}.${lastActor}.md`;
        const backupPath = path.join(HISTORY_DIR, backupFilename);
        fs.copyFileSync(filePath, backupPath);
      } catch (backupError) {
        logger.error({ err: backupError, taskId: id }, 'Task backup failed');
      }
    }

    let changeDetails = [];

    const fieldsToTrack = ['title', 'priority', 'assignee', 'type', 'component', 'claude_session_id'];
    fieldsToTrack.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== currentData[field]) {
        const oldVal = currentData[field] || 'none';
        const newVal = req.body[field] || 'none';
        changeDetails.push(`${field} changed from ${oldVal} to ${newVal}`);
      }
    });

    if (tags !== undefined) {
      const oldTags = currentData.tags || [];
      const newTags = tags || [];
      const added = newTags.filter(t => !oldTags.includes(t));
      const removed = oldTags.filter(t => !newTags.includes(t));

      if (added.length > 0 || removed.length > 0) {
        let tagMsg = 'tags updated';
        if (added.length > 0) tagMsg += `: added [${added.join(', ')}]`;
        if (removed.length > 0) tagMsg += `${added.length > 0 ? ', ' : ': '}removed [${removed.join(', ')}]`;
        changeDetails.push(tagMsg);
      }
    }

    if (files_affected !== undefined) {
      const oldFiles = currentData.files_affected || [];
      const newFiles = files_affected || [];
      const added = newFiles.filter(f => !oldFiles.includes(f));
      const removed = oldFiles.filter(f => !newFiles.includes(f));

      if (added.length > 0 || removed.length > 0) {
        let fileMsg = 'files affected updated';
        if (added.length > 0) fileMsg += `: added [${added.join(', ')}]`;
        if (removed.length > 0) fileMsg += `${added.length > 0 ? ', ' : ': '}removed [${removed.join(', ')}]`;
        changeDetails.push(fileMsg);
      }
    }

    // Dependency check: warn if moving to in_progress with unfinished dependencies
    if (status === 'in_progress' && newData.depends_on && newData.depends_on.length > 0) {
      const allTasks = getAllTasks(TASKS_DIR);
      const blocking = newData.depends_on.filter(depId => {
        const dep = allTasks.find(t => t.id === depId);
        return dep && dep.status !== 'done';
      });
      if (blocking.length > 0) {
        res.setHeader('X-Warning', `Blocked by unfinished tasks: ${blocking.join(', ')}`);
      }
    }

    // Auto-assign: if moving to in_progress with no assignee, use the actor
    if (status === 'in_progress' && !newData.assignee && actor !== 'Agent') {
      newData.assignee = actor;
      changeDetails.push(`assignee changed from none to ${actor}`);
    }

    // Auto-timestamp based on status change
    if (status !== undefined && status !== currentData.status) {
      if (status === 'in_progress' && !newData.started_at) {
        newData.started_at = now;
        newData.activity_log.push({ timestamp: now, action: `Status changed to IN PROGRESS by ${actor}` });
      } else if (status === 'review' && !newData.reviewed_at) {
        newData.reviewed_at = now;
        newData.activity_log.push({ timestamp: now, action: `Status changed to REVIEW by ${actor}` });
      } else if (status === 'done' && !newData.done_at) {
        newData.done_at = now;
        newData.activity_log.push({ timestamp: now, action: `Task marked as DONE by ${actor}` });
      } else {
        if (currentData.status === 'done' && status !== 'done') {
          newData.done_at = null;
          newData.activity_log.push({ timestamp: now, action: `Task RE-OPENED and moved to ${status.toUpperCase()} by ${actor}` });
        } else {
          newData.activity_log.push({ timestamp: now, action: `Status changed from ${currentData.status || 'todo'} to ${status} by ${actor}` });
        }

        if ((status === 'draft' || status === 'todo' || status === 'in_progress') && newData.reviewed_at) {
          newData.reviewed_at = null;
        }
        if ((status === 'draft' || status === 'todo') && newData.started_at) {
          newData.started_at = null;
        }
      }
    }

    if (content !== undefined && content !== currentContent) {
      newData.activity_log.push({ timestamp: now, action: `Description or Comments updated by ${actor}` });
    }

    if (project !== undefined && project !== originalProject) {
      newData.activity_log.push({ timestamp: now, action: `Moved from project '${originalProject}' to '${project}' by ${actor}` });
    }

    if (changeDetails.length > 0) {
      changeDetails.forEach(detail => {
        newData.activity_log.push({ timestamp: now, action: `${detail} by ${actor}` });
      });
    }

    // Clean up newData
    Object.keys(newData).forEach(key => {
      if (newData[key] === undefined || newData[key] === null || newData[key] === '') {
        if (key !== 'assignee' && key !== 'component' && key !== 'parent_task' && !key.endsWith('_at') && key !== 'activity_log') {
          delete newData[key];
        } else if (newData[key] === undefined) {
          delete newData[key];
        }
      }
    });

    // Cap activity log before writing
    trimActivityLog(id, newData);

    const newBodyContent = content !== undefined ? content : currentContent;
    const newFileContent = matter.stringify(newBodyContent, newData);

    // Handle project move
    if (project !== undefined && project !== originalProject) {
      const targetDir = project === 'Root' ? TASKS_DIR : path.join(TASKS_DIR, project);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const newFileName = path.basename(filePath);
      const newFilePath = path.join(targetDir, newFileName);

      atomicWriteFileSync(newFilePath, newFileContent);

      if (fs.existsSync(filePath) && filePath !== newFilePath) {
        fs.unlinkSync(filePath);
      }
      indexSet(id, newFilePath);
    } else {
      atomicWriteFileSync(filePath, newFileContent);
      indexSet(id, filePath);
    }

    const updatedTask = { ...newData, content: newBodyContent, project: project || originalProject };
    res.json({ success: true, task: updatedTask });
    const io = getIO();
    if (io) io.emit('task_updated', withSummary(updatedTask));
    taskWaiters.notify(updatedTask);
    }); // end withLock
  } catch (error) {
    logger.error({ err: error, taskId: id }, 'Task update failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks:
 *   post:
 *     summary: Create a task
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               id:
 *                 type: string
 *                 description: "Human-readable ID (format: category-descriptor-number). Auto-generated if omitted."
 *                 example: feat-auth-001
 *               title:
 *                 type: string
 *                 example: Implement JWT Login
 *               status:
 *                 type: string
 *                 enum: [todo, in_progress, review, done]
 *                 default: todo
 *               priority:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 default: medium
 *               content:
 *                 type: string
 *                 default: ""
 *               project:
 *                 type: string
 *                 default: Root
 *               type:
 *                 type: string
 *                 enum: [frontend, backend, fullstack, devops]
 *                 default: fullstack
 *               component:
 *                 type: string
 *                 nullable: true
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               parent_task:
 *                 type: string
 *                 nullable: true
 *               created_by:
 *                 type: string
 *     responses:
 *       201:
 *         description: Task created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 task:
 *                   $ref: '#/components/schemas/Task'
 */
router.post('/', (req, res) => {
  try {
    const { title, status = 'todo', priority = 'medium', content = '', project = 'Root', type = 'fullstack', component = null, tags = [], parent_task = null, depends_on = [], due_date = null, id, created_by } = req.body;

    // Enforce the canonical task-id convention at creation time. No fallback.
    // See CLAUDE.md "Task ID (STRICT)".
    const { validateTaskId } = require('../lib/taskIdValidator');
    const idError = validateTaskId(id);
    if (idError) return res.status(400).json(idError);
    const taskId = sanitizeFilename(id);
    if (!taskId || taskId !== id) {
      return res.status(400).json({
        error: 'id contains characters that cannot be used as a filename',
        received: id,
      });
    }
    const safeProject = project === 'Root' ? 'Root' : sanitizeFilename(project);
    const targetDir = safeProject === 'Root' ? TASKS_DIR : safePath(TASKS_DIR, safeProject);

    if (!targetDir) {
      return res.status(400).json({ error: 'Invalid project name' });
    }

    // Agent contract: tasks cannot be created in archived projects
    if (safeProject !== 'Root') {
      const projectRegistry = require('../lib/projectRegistry');
      const proj = projectRegistry.resolve(safeProject);
      if (proj && proj.archived === true) {
        return res.status(403).json({ error: 'Project is archived; cannot create tasks here' });
      }
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = safePath(targetDir, `${taskId}.md`);
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    // Warn if content is empty
    if (!content || !content.trim()) {
      res.setHeader('X-Warning', 'Task created with empty content/description');
    }

    // Duplicate detection — reject if task ID already exists
    if (fs.existsSync(filePath)) {
      const existing = matter.read(filePath);
      return res.status(409).json({ error: 'Task ID already exists', existing_task: { id: taskId, title: existing.data.title, status: existing.data.status } });
    }

    const now = new Date().toISOString();
    const creator = created_by || 'Unknown User';
    const data = {
      id: taskId,
      title,
      status,
      priority,
      type,
      component,
      tags,
      parent_task,
      depends_on,
      due_date,
      created_at: now,
      activity_log: [{ timestamp: now, action: `Task created by ${creator}` }]
    };

    Object.keys(data).forEach(key => {
      if (data[key] === undefined || data[key] === null || data[key] === '') {
        delete data[key];
      }
    });

    const fileContent = matter.stringify(content, data);
    atomicWriteFileSync(filePath, fileContent);
    indexSet(taskId, filePath);

    const createdTask = { id: taskId, ...data, content, project };
    res.status(201).json({ success: true, task: createdTask });
    const io = getIO();
    if (io) io.emit('task_created', withSummary(createdTask));
    taskWaiters.notify(createdTask);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/:id/rename — change a task's id (re-categorize, fix typos).
// Validates new_id, renames the .md file, updates the YAML id field, rebuilds the index,
// and auto-preserves any branch link by setting github_branch if needed.
router.post('/:id/rename', async (req, res) => {
  const { id } = req.params;
  try {
    await withLock(`task:${id}`, async () => {
    const { new_id, renamed_by } = req.body;

    // Validate the new id against the canonical regex
    const { validateTaskId } = require('../lib/taskIdValidator');
    const idError = validateTaskId(new_id);
    if (idError) return res.status(400).json(idError);
    if (new_id === id) return res.status(400).json({ error: 'new_id is the same as the current id' });

    // Find the source file
    const sourcePath = findTaskFilePath(id);
    if (!sourcePath) return res.status(404).json({ error: 'Task not found' });

    // Check the new id doesn't already exist
    if (findTaskFilePath(new_id)) return res.status(409).json({ error: 'A task with that id already exists', existing_id: new_id });

    // Check archived project
    const sourceDir = path.dirname(sourcePath);
    const relativePath = path.relative(TASKS_DIR, sourceDir);
    const project = relativePath || 'Root';
    if (project !== 'Root') {
      const projectRegistry = require('../lib/projectRegistry');
      const proj = projectRegistry.resolve(project);
      if (proj && proj.archived === true) {
        return res.status(403).json({ error: 'Project is archived; cannot rename tasks here' });
      }
    }

    // Read the source file
    const fileContent = fs.readFileSync(sourcePath, 'utf-8');
    const parsed = matter(fileContent);
    const data = parsed.data;
    const content = parsed.content;

    // Auto-preserve branch link: if the old id was used for branch substring matching
    // and there's no explicit github_branch override yet, set one so the link isn't lost.
    if (!data.github_branch) {
      // Check if any local branch or PR used the old id for matching.
      // Simple heuristic: if a branch name contains the old id, save it as the override.
      try {
        const { execFileSync } = require('child_process');
        const { SETTINGS_FILE } = require('../lib/constants');
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        const wd = settings.workingDirectory;
        if (wd) {
          const registry = require('../lib/projectRegistry');
          const proj = registry.resolve(project);
          if (proj && proj.folder !== 'Root') {
            const repoPath = path.join(wd, proj.folder);
            if (fs.existsSync(path.join(repoPath, '.git'))) {
              const branchesRaw = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { cwd: repoPath, encoding: 'utf8' });
              const branches = branchesRaw.split('\n').filter(Boolean);
              const match = branches.find(b => b.toLowerCase().includes(id.toLowerCase()));
              if (match) data.github_branch = match;
            }
          }
        }
      } catch { /* non-critical — just skip auto-linking */ }
    }

    // Update the id + add activity_log entry
    const now = new Date().toISOString();
    const actor = renamed_by || req.user?.username || 'Unknown User';
    data.id = new_id;
    if (!Array.isArray(data.activity_log)) data.activity_log = [];
    data.activity_log.push({ timestamp: now, action: `id renamed from ${id} to ${new_id} by ${actor}` });

    // Write to the new filename
    const newFilePath = safePath(sourceDir, `${sanitizeFilename(new_id)}.md`);
    if (!newFilePath) return res.status(400).json({ error: 'Invalid new id for filename' });
    const newFileContent = matter.stringify(content, data);
    atomicWriteFileSync(newFilePath, newFileContent);

    // Remove the old file + update the index
    if (sourcePath !== newFilePath && fs.existsSync(sourcePath)) {
      fs.unlinkSync(sourcePath);
    }
    indexDelete(id);
    indexSet(new_id, newFilePath);

    const updatedTask = { ...data, content: content.trim(), project };
    res.json({ success: true, task: updatedTask, old_id: id });
    const io = getIO();
    if (io) {
      io.emit('task_deleted', { id });
      io.emit('task_created', withSummary(updatedTask));
    }
    }); // end withLock
  } catch (error) {
    logger.error({ err: error, taskId: id }, 'Task rename failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/:id/continue — create a downstream phase task pre-filled from this one
// Source must be phase-research → creates phase-plan; phase-plan → creates phase-implement.
router.post('/:id/continue', async (req, res) => {
  try {
    const sourceId = req.params.id;
    const sourcePath = findTaskFilePath(sourceId);
    if (!sourcePath) return res.status(404).json({ error: 'Source task not found' });

    const sourceFile = fs.readFileSync(sourcePath, 'utf-8');
    const sourceParsed = matter(sourceFile);
    const sourceData = sourceParsed.data || {};
    const sourceContent = sourceParsed.content || '';
    const sourceTags = Array.isArray(sourceData.tags) ? sourceData.tags : [];

    let nextPhase = null;
    let nextShort = null;
    if (sourceTags.includes('phase-research')) { nextPhase = 'phase-plan'; nextShort = 'plan'; }
    else if (sourceTags.includes('phase-plan')) { nextPhase = 'phase-implement'; nextShort = 'implement'; }
    else return res.status(400).json({ error: 'Source task is not phased (expected phase-research or phase-plan tag)' });

    // Base ID: strip any trailing phase suffix from the source, then append the next phase
    const baseId = sourceId.replace(/-research$|-plan$|-implement$/, '');
    let candidateId = `${baseId}-${nextShort}`;
    // If already taken, suffix a counter
    let counter = 2;
    while (findTaskFilePath(candidateId)) {
      candidateId = `${baseId}-${nextShort}-${counter}`;
      counter++;
    }
    const newId = sanitizeFilename(candidateId);
    if (!newId) return res.status(500).json({ error: 'Failed to derive new task ID' });

    // Load the next phase template if present for its default content + type/priority hints
    const templatePath = path.join(__dirname, '..', 'templates', `${nextPhase}.json`);
    let template = null;
    if (fs.existsSync(templatePath)) {
      try { template = JSON.parse(fs.readFileSync(templatePath, 'utf-8')); } catch (e) { template = null; }
    }

    // Build the new task's description with the parent content injected at top
    const injected = [
      `### Context from parent\n`,
      `This task continues from **${sourceId}** — _${sourceData.title || 'Untitled'}_.`,
      nextPhase === 'phase-plan'
        ? 'The research findings are below. Read them before proposing a plan. Share open questions with the human before writing the full plan.'
        : 'The plan is below. Read it phase by phase. Do not re-plan; if the plan is wrong, move this task back to review with a note.',
      `\n<details>\n<summary>Parent task body</summary>\n\n${sourceContent.trim()}\n\n</details>\n`,
      `### Description\n\n_(add additional notes here; the parent content is above)_\n\n### Comments\n`,
    ].join('\n');

    const actor = req.user?.username || req.body?.created_by || 'Unknown User';
    const now = new Date().toISOString();
    const targetProject = sourceData.project || 'Root';
    const safeProject = targetProject === 'Root' ? 'Root' : sanitizeFilename(targetProject);
    // Derive target directory: same project folder as source (walk up from sourcePath)
    const sourceDir = path.dirname(sourcePath);

    const filePath = safePath(sourceDir, `${newId}.md`);
    if (!filePath) return res.status(400).json({ error: 'Invalid target path' });
    if (fs.existsSync(filePath)) return res.status(409).json({ error: 'Target task already exists', id: newId });

    const templateTags = Array.isArray(template?.defaults?.tags) ? template.defaults.tags : [nextPhase];
    const sourceOnlyTags = sourceTags.filter(t => !t.startsWith('phase-'));
    const mergedTags = Array.from(new Set([...templateTags, ...sourceOnlyTags]));

    const data = {
      id: newId,
      title: `${sourceData.title || 'Untitled'} — ${nextShort}`,
      status: 'todo',
      priority: template?.defaults?.priority || sourceData.priority || 'medium',
      type: template?.defaults?.type || sourceData.type || 'fullstack',
      component: sourceData.component || null,
      tags: mergedTags,
      files_affected: sourceData.files_affected || [],
      parent_task: sourceId,
      depends_on: [sourceId],
      created_at: now,
      activity_log: [
        { timestamp: now, action: `Task created by ${actor} as continuation of ${sourceId}` },
      ],
    };
    Object.keys(data).forEach(k => { if (data[k] === undefined || data[k] === null || data[k] === '') delete data[k]; });

    const fileContent = matter.stringify(injected, data);
    atomicWriteFileSync(filePath, fileContent);
    indexSet(newId, filePath);

    const createdTask = { id: newId, ...data, content: injected, project: targetProject };
    res.status(201).json({ success: true, task: createdTask });
    try { getIO()?.emit('task_created', withSummary(createdTask)); } catch (e) {}
  } catch (error) {
    logger.error({ err: error }, 'Failed to continue task');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/batch — create multiple tasks in one request
router.post('/batch', (req, res) => {
  try {
    const { tasks: taskList } = req.body;
    if (!Array.isArray(taskList) || taskList.length === 0) {
      return res.status(400).json({ error: 'tasks array required' });
    }
    if (taskList.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 tasks per batch' });
    }

    const results = [];
    const io = getIO();

    for (const task of taskList) {
      try {
        const { title, status = 'todo', priority = 'medium', content = '', project = 'Root', type = 'fullstack', component = null, tags = [], parent_task = null, due_date = null, id, created_by, files_affected = [] } = task;

        if (!id || !title) {
          results.push({ id: id || null, success: false, error: 'id and title required' });
          continue;
        }

        const taskId = sanitizeFilename(id) || `task-${Date.now()}`;
        const safeProject = project === 'Root' ? 'Root' : sanitizeFilename(project);
        const targetDir = safeProject === 'Root' ? TASKS_DIR : safePath(TASKS_DIR, safeProject);

        if (!targetDir) {
          results.push({ id: taskId, success: false, error: 'Invalid project name' });
          continue;
        }

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const filePath = safePath(targetDir, `${taskId}.md`);
        if (!filePath) {
          results.push({ id: taskId, success: false, error: 'Invalid task ID' });
          continue;
        }

        // Check for duplicate
        if (fs.existsSync(filePath)) {
          results.push({ id: taskId, success: false, error: 'Task ID already exists' });
          continue;
        }

        const now = new Date().toISOString();
        const creator = created_by || 'Unknown User';
        const data = {
          id: taskId, title, status, priority, type, component, tags,
          files_affected, parent_task, due_date,
          created_at: now,
          activity_log: [{ timestamp: now, action: `Task created by ${creator}` }]
        };

        Object.keys(data).forEach(key => {
          if (data[key] === undefined || data[key] === null || data[key] === '') delete data[key];
        });

        const fileContent = matter.stringify(content, data);
        atomicWriteFileSync(filePath, fileContent);
        indexSet(taskId, filePath);

        const createdTask = { id: taskId, ...data, content, project };
        results.push({ id: taskId, success: true });
        if (io) io.emit('task_created', withSummary(createdTask));
      } catch (err) {
        results.push({ id: task.id || null, success: false, error: err.message });
      }
    }

    const created = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    res.status(201).json({ success: true, created, failed, results });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/:id/activity — full activity log including archived entries
router.get('/:id/activity', (req, res) => {
  try {
    const { id } = req.params;
    const filePath = findTaskFilePath(id);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
    const fullLog = getFullActivityLog(id, parsed.data);

    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const page = fullLog.slice(offset, offset + limit);

    res.json({ total: fullLog.length, offset, limit, entries: page });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks/{id}/history:
 *   get:
 *     summary: Get history versions for a task
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of backup versions sorted newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/HistoryEntry'
 */
router.get('/:id/history', (req, res) => {
  try {
    const { id } = req.params;
    if (!fs.existsSync(HISTORY_DIR)) {
      return res.json([]);
    }

    const files = fs.readdirSync(HISTORY_DIR);
    const history = files
      .filter(f => f.startsWith(`${id}.`) && f.endsWith('.md'))
      .map(f => {
        const stats = fs.statSync(path.join(HISTORY_DIR, f));
        const parts = f.split('.');
        let timestampFromFilename = null;
        let author = null;

        if (parts.length >= 3) {
          timestampFromFilename = parseInt(parts[1]);
          if (parts.length >= 4) {
            author = parts[2];
          }
        }

        return {
          filename: f,
          timestamp: timestampFromFilename ? new Date(timestampFromFilename).toISOString() : stats.mtime.toISOString(),
          author: author,
          size: stats.size
        };
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(history);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks/{id}/history/{filename}:
 *   get:
 *     summary: Get a specific history version
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: History version data and content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                 content:
 *                   type: string
 *       404:
 *         description: History file not found
 */
router.get('/:id/history/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = safePath(HISTORY_DIR, sanitizeFilename(filename));
    if (!filePath) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = matter(fileContent);
      res.json({ data, content: content.trim() });
    } else {
      res.status(404).json({ error: 'History file not found' });
    }
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks/{id}/history/{filename}/restore:
 *   post:
 *     summary: Restore a task to a previous version
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               updated_by:
 *                 type: string
 *     responses:
 *       200:
 *         description: Task restored
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 task:
 *                   $ref: '#/components/schemas/Task'
 */
router.post('/:id/history/:filename/restore', async (req, res) => {
  const { id, filename } = req.params;
  try {
    await withLock(`task:${id}`, async () => {
      const { updated_by } = req.body;
      const historyPath = safePath(HISTORY_DIR, sanitizeFilename(filename));
      if (!historyPath) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }
      const currentPath = findTaskFilePath(id);

      if (!fs.existsSync(historyPath)) {
        res.status(404).json({ error: 'History version not found' });
        return;
      }

      if (!currentPath) {
        res.status(404).json({ error: 'Current task file not found' });
        return;
      }

      const backupName = `${id}.${Date.now()}.md`;
      fs.copyFileSync(currentPath, path.join(HISTORY_DIR, backupName));
      fs.copyFileSync(historyPath, currentPath);

      const restoredFileContent = fs.readFileSync(currentPath, 'utf-8');
      const parsed = matter(restoredFileContent);
      const data = parsed.data;
      const now = new Date().toISOString();
      const actor = updated_by || 'Agent';

      const parts = filename.split('.');
      const histTs = parts.length > 2 ? new Date(parseInt(parts[parts.length - 2])).toLocaleString() : 'previous version';

      data.activity_log = data.activity_log || [];
      data.activity_log.push({
        timestamp: now,
        action: `Task RESTORED to version from ${histTs} by ${actor}`
      });
      trimActivityLog(id, data);

      const finalContent = matter.stringify(parsed.content, data);
      atomicWriteFileSync(currentPath, finalContent);

      const restoredTask = { ...data, content: parsed.content, project: path.relative(TASKS_DIR, path.dirname(currentPath)) || 'Root' };
      res.json({ success: true, task: restoredTask });
      const io = getIO();
      if (io) io.emit('task_updated', withSummary(restoredTask));
    });
  } catch (error) {
    logger.error({ err: error, taskId: id }, 'Task restore failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/:id/restore-from-trash — recover a trashed task
router.post('/:id/restore-from-trash', async (req, res) => {
  const { id } = req.params;
  try {
    const trashPath = path.join(TRASH_DIR, `${id}.md`);
    if (!fs.existsSync(trashPath)) {
      return res.status(404).json({ error: 'Task not found in trash' });
    }

    const fileContent = fs.readFileSync(trashPath, 'utf-8');
    const parsed = matter(fileContent);
    const project = parsed.data.deleted_from || 'Root';
    delete parsed.data.deleted_at;
    delete parsed.data.deleted_from;

    const now = new Date().toISOString();
    parsed.data.activity_log = parsed.data.activity_log || [];
    parsed.data.activity_log.push({ timestamp: now, action: 'Task restored from trash' });

    const targetDir = project === 'Root' ? TASKS_DIR : path.join(TASKS_DIR, project);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const restorePath = path.join(targetDir, `${id}.md`);
    atomicWriteFileSync(restorePath, matter.stringify(parsed.content, parsed.data));
    fs.unlinkSync(trashPath);
    indexSet(id, restorePath);

    const restoredTask = { ...parsed.data, content: parsed.content.trim(), project };
    res.json({ success: true, task: restoredTask });
    const io = getIO();
    if (io) io.emit('task_created', withSummary(restoredTask));
  } catch (error) {
    logger.error({ err: error, taskId: id }, 'Trash restore failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/tasks/{id}:
 *   delete:
 *     summary: Delete a task
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Task deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       404:
 *         description: Task not found
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const permanent = req.query.permanent === 'true';
  try {
    await withLock(`task:${id}`, async () => {
      const filePath = findTaskFilePath(id);

      if (filePath && fs.existsSync(filePath)) {
        if (permanent) {
          fs.unlinkSync(filePath);
        } else {
          // Soft delete: move to .trash with deleted_at metadata
          if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const parsed = matter(fileContent);
          parsed.data.deleted_at = new Date().toISOString();
          parsed.data.deleted_from = path.relative(TASKS_DIR, path.dirname(filePath)) || 'Root';
          const trashPath = path.join(TRASH_DIR, `${id}.md`);
          fs.writeFileSync(trashPath, matter.stringify(parsed.content, parsed.data));
          fs.unlinkSync(filePath);
        }
        indexDelete(id);
        res.json({ success: true });
        const io = getIO();
        if (io) io.emit('task_deleted', { id });
      } else {
        res.status(404).json({ error: 'Task not found' });
      }
    });
  } catch (error) {
    logger.error({ err: error, taskId: id }, 'Task delete failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
