const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { TASKS_DIR, HISTORY_DIR } = require('./constants');
const { logger } = require('./logger');
const { generateSummary } = require('./taskSummary');

// --- In-memory index: taskId -> filePath ---
const taskIndex = new Map();
let indexBuilt = false;

// --- Task cache: avoids full filesystem scan on every GET request ---
let tasksCache = null;
let tasksCacheTime = 0;
const CACHE_TTL_MS = 5000; // 5 seconds

const invalidateCache = () => {
  tasksCache = null;
  tasksCacheTime = 0;
};

// Build the index by scanning the tasks directory once
const buildIndex = () => {
  taskIndex.clear();
  scanDirectory(TASKS_DIR);
  indexBuilt = true;
};

const scanDirectory = (dirPath) => {
  const files = fs.readdirSync(dirPath);
  files.forEach((file) => {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      // Skipping dot-prefixed dirs is what keeps archived projects out of the
      // task index (.archived/) alongside .history/.trash. Do NOT loosen this
      // rule without updating the archive route contract.
      if (!file.startsWith('.')) {
        scanDirectory(filePath);
      }
    } else if (file.endsWith('.md') && file.toLowerCase() !== 'readme.md') {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const { data } = matter(fileContent);
        const id = data.id || file.replace('.md', '');
        taskIndex.set(id, filePath);
      } catch (err) {
        logger.warn({ err, filePath }, 'Failed to index task file');
      }
    }
  });
};

// Ensure index is built (lazy init)
const ensureIndex = () => {
  if (!indexBuilt) buildIndex();
};

// Update the index for a single task
const indexSet = (id, filePath) => {
  taskIndex.set(id, filePath);
  invalidateCache();
};

// Remove a task from the index
const indexDelete = (id) => {
  taskIndex.delete(id);
  invalidateCache();
};

// Recursively find all markdown files in the tasks directory
const scanAllTasks = (dirPath = TASKS_DIR, tasksArray = []) => {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      if (!file.startsWith('.')) {
        scanAllTasks(filePath, tasksArray);
      }
    } else if (file.endsWith('.md') && file.toLowerCase() !== 'readme.md') {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = matter(fileContent);

      const project = require('./taskPaths').deriveProject(filePath);
      const id = data.id || file.replace('.md', '');

      // Keep the index in sync during full scans
      taskIndex.set(id, filePath);

      const taskObj = {
        id,
        title: data.title || 'Untitled',
        status: data.status || 'todo',
        priority: data.priority || 'medium',
        assignee: data.assignee || null,
        type: data.type || 'fullstack',
        component: data.component || null,
        tags: data.tags || [],
        files_affected: data.files_affected || [],
        parent_task: data.parent_task || null,
        created_at: data.created_at || null,
        started_at: data.started_at || null,
        reviewed_at: data.reviewed_at || null,
        done_at: data.done_at || null,
        activity_log: data.activity_log || [],
        github_branch: data.github_branch || null,
        github_pr_url: data.github_pr_url || null,
        // Playwright e2e gate (feat-e2e-validation-001) + run summary (feat-e2e-tests-tab-001).
        // Both PRs added the write path in routes/tasks.js but missed extending the read path
        // here, so on-disk values were silently dropped on GET. The Tests tab depends on this.
        e2e_status: data.e2e_status || null,
        e2e_run: data.e2e_run || null,
        // Which atrium.tests.json suite produced e2e_status (feat-runners-core-001).
        e2e_suite: data.e2e_suite || null,
        // Per-task claude session UUID — bound on first Shell-tab spawn so
        // resume targets THIS task's conversation, not the cwd's most-recent.
        // Source of truth lives in YAML so the binding survives across
        // browsers / machines (localStorage was the original storage in
        // feat-shell-task-resume-001 and is now demoted to a cache).
        claude_session_id: data.claude_session_id || null,
        project: project,
        content: content.trim(),
        filePath: filePath
      };
      taskObj.summary = generateSummary(taskObj);
      tasksArray.push(taskObj);
    }
  });

  indexBuilt = true;
  return tasksArray;
};

// Cached wrapper — returns cached result if fresh, otherwise rescans
const getAllTasks = (dirPath = TASKS_DIR) => {
  const now = Date.now();
  if (tasksCache && (now - tasksCacheTime) < CACHE_TTL_MS) {
    return tasksCache;
  }
  const tasks = scanAllTasks(dirPath);
  tasksCache = tasks;
  tasksCacheTime = now;
  return tasks;
};

// O(1) lookup for a task's file path
const findTaskFilePath = (id) => {
  ensureIndex();
  return taskIndex.get(id) || null;
};

// Atomic write: write to .tmp file then rename to final path
// Prevents corruption if server crashes mid-write
const atomicWriteFileSync = (filePath, content) => {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
};

// Cleanup stale .tmp files from a crashed write (call on startup)
const cleanupTempFiles = (dirPath = TASKS_DIR) => {
  let cleaned = 0;
  const scan = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory() && !file.startsWith('.')) {
        scan(fullPath);
      } else if (file.endsWith('.tmp')) {
        try { fs.unlinkSync(fullPath); cleaned++; } catch (e) {}
      }
    }
  };
  scan(dirPath);
  if (cleaned > 0) logger.warn({ count: cleaned }, 'Cleaned up stale .tmp files from previous crash');
};

// Cap activity_log to MAX_LOG_ENTRIES, archiving overflow to .history
const MAX_LOG_ENTRIES = 200;

const trimActivityLog = (taskId, data) => {
  if (!data.activity_log || data.activity_log.length <= MAX_LOG_ENTRIES) return;

  const overflow = data.activity_log.slice(0, data.activity_log.length - MAX_LOG_ENTRIES);
  data.activity_log = data.activity_log.slice(-MAX_LOG_ENTRIES);

  // Archive overflow entries to a JSON file in .history
  try {
    const archivePath = path.join(HISTORY_DIR, `${taskId}.activity-archive.json`);
    let existing = [];
    if (fs.existsSync(archivePath)) {
      try { existing = JSON.parse(fs.readFileSync(archivePath, 'utf-8')); } catch (e) { existing = []; }
    }
    const merged = existing.concat(overflow);
    fs.writeFileSync(archivePath, JSON.stringify(merged, null, 2));
  } catch (err) {
    logger.warn({ err, taskId }, 'Failed to archive activity log overflow');
  }
};

// Load full activity log (in-file + archived) for a task
const getFullActivityLog = (taskId, data) => {
  const archivePath = path.join(HISTORY_DIR, `${taskId}.activity-archive.json`);
  let archived = [];
  if (fs.existsSync(archivePath)) {
    try { archived = JSON.parse(fs.readFileSync(archivePath, 'utf-8')); } catch (e) { archived = []; }
  }
  const current = (data && data.activity_log) || [];
  return archived.concat(current);
};

// Narrow internal helper for backend modules that need to update a single
// YAML field without going through the full PUT route (which requires auth
// and runs validation that's unnecessary for fire-and-forget side-effects
// like the web-shell socket minting claude_session_id on first spawn).
//
// Mirrors the route's atomic-write + activity-log conventions:
//   - acquires the same task:<id> mutex so it can't race the route
//   - appends ONE activity_log entry when `actionMessage` is provided
//   - calls trimActivityLog so the log can't grow unbounded
//   - invalidates the tasks cache + updates the index
//   - emits task_updated over socket.io so clients refresh
//
// Returns the merged task data (frontmatter + body) so callers can use the
// resolved value directly. Throws if the task isn't found.
const updateTaskField = async (taskId, field, value, actor = 'Agent', actionMessage = null) => {
  const { withLock } = require('./lock');
  const { getIO } = require('./io');

  return await withLock(`task:${taskId}`, async () => {
    const filePath = findTaskFilePath(taskId);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    const data = parsed.data || {};
    data[field] = value;
    data.activity_log = data.activity_log || [];
    if (actionMessage) {
      data.activity_log.push({
        timestamp: new Date().toISOString(),
        action: `${actionMessage} by ${actor}`,
      });
      trimActivityLog(taskId, data);
    }
    const newContent = matter.stringify(parsed.content, data);
    atomicWriteFileSync(filePath, newContent);
    invalidateCache();
    indexSet(taskId, filePath);

    const project = require('./taskPaths').deriveProject(filePath);
    const taskObj = {
      ...data,
      id: taskId,
      project,
      content: (parsed.content || '').trim(),
    };
    try {
      const io = getIO();
      if (io) io.emit('task_updated', { ...taskObj, summary: generateSummary(taskObj) });
    } catch { /* socket.io not initialised yet during boot */ }
    return taskObj;
  });
};

// Append a comment to a task's `### Comments` section in-process (used by the
// loop engine for fire-and-forget side-effects). Mirrors updateTaskField's
// conventions: same task:<id> mutex, one activity_log entry, atomic write,
// cache invalidation, and a task_updated socket emit. The comment is inserted
// immediately after the `### Comments` header (newest-first), matching the MCP
// append_comment tool. Creates the section if it's missing. Throws if the task
// isn't found.
const appendComment = async (taskId, comment, actor = 'Agent') => {
  const { withLock } = require('./lock');
  const { getIO } = require('./io');

  return await withLock(`task:${taskId}`, async () => {
    const filePath = findTaskFilePath(taskId);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    const data = parsed.data || {};
    const trimmed = String(comment || '').trim();
    let body = parsed.content || '';

    const marker = '### Comments';
    const idx = body.indexOf(marker);
    if (idx !== -1) {
      const before = body.slice(0, idx + marker.length);
      const after = body.slice(idx + marker.length);
      body = `${before}\n${trimmed}\n${after}`;
    } else {
      body = `${body.trimEnd()}\n\n${marker}\n${trimmed}\n`;
    }

    data.activity_log = data.activity_log || [];
    data.activity_log.push({
      timestamp: new Date().toISOString(),
      action: `Comment added by ${actor}`,
    });
    trimActivityLog(taskId, data);

    const newContent = matter.stringify(body, data);
    atomicWriteFileSync(filePath, newContent);
    invalidateCache();
    indexSet(taskId, filePath);

    const project = require('./taskPaths').deriveProject(filePath);
    const taskObj = { ...data, id: taskId, project, content: body.trim() };
    try {
      const io = getIO();
      if (io) io.emit('task_updated', { ...taskObj, summary: generateSummary(taskObj) });
    } catch { /* socket.io not initialised yet during boot */ }
    return taskObj;
  });
};

// Create a task in-process (used by the loop engine to turn a new GitHub issue
// into a draft task). Mirrors the POST /api/tasks core: id validation, project
// folder resolution, atomic write, index update, task_created socket emit.
// Throws an error with `.status` (400 invalid id / 409 duplicate) on failure.
// Does NOT notify taskWaiters — issue-imported tasks default to `draft`, which
// the wait-for-next-todo loop ignores anyway.
const createTask = (fields = {}) => {
  const { validateTaskId } = require('./taskIdValidator');
  const { sanitizeFilename, safePath } = require('./sanitize');
  const { getIO } = require('./io');
  const {
    id, title = 'Untitled', status = 'draft', priority = 'medium',
    content = '', project = 'Root', type = 'fullstack', component = null,
    tags = [], parent_task = null, depends_on = [], created_by = 'Agent',
  } = fields;

  const idError = validateTaskId(id);
  if (idError) { const e = new Error('Invalid task id'); e.status = 400; e.details = idError; throw e; }
  const taskId = sanitizeFilename(id);
  if (!taskId || taskId !== id) { const e = new Error('id is not filename-safe'); e.status = 400; throw e; }

  const safeProject = project === 'Root' ? 'Root' : sanitizeFilename(project);
  if (!safeProject) { const e = new Error('Invalid project name'); e.status = 400; throw e; }
  // Nested layout: the project's directory lives under its workspace's
  // directory. Safe by construction — folder is sanitized, workspace dir
  // comes from the registry via taskPaths.
  const targetDir = require('./taskPaths').projectTaskDir(safeProject);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const filePath = safePath(targetDir, `${taskId}.md`);
  if (!filePath) { const e = new Error('Invalid task id'); e.status = 400; throw e; }
  if (fs.existsSync(filePath)) { const e = new Error('Task id already exists'); e.status = 409; throw e; }

  const now = new Date().toISOString();
  const data = {
    id: taskId, title, status, priority, type, component,
    tags, parent_task, depends_on,
    created_at: now,
    activity_log: [{ timestamp: now, action: `Task created by ${created_by}` }],
  };
  Object.keys(data).forEach((k) => {
    if (data[k] === undefined || data[k] === null || data[k] === '') delete data[k];
  });

  const fileContent = matter.stringify(content, data);
  atomicWriteFileSync(filePath, fileContent);
  indexSet(taskId, filePath);

  const created = { id: taskId, ...data, content, project: safeProject };
  try {
    const io = getIO();
    if (io) io.emit('task_created', { ...created, summary: generateSummary(created) });
  } catch { /* socket.io not ready */ }
  return created;
};

// Claim the next eligible `todo` task in a project for a worker loop
// (feat-loopsv2-worker-001). Eligible = status todo, not a draft/no-code task,
// and unassigned or already assigned to this worker. Atomically flips the first
// match to in_progress under a per-task lock; returns the claimed task or null.
const isEligibleForWorker = (t, project, assignee) =>
  t && t.status === 'todo'
  && (t.project || 'Root') === project
  && (!t.assignee || t.assignee === assignee)
  && !((t.tags || []).includes('no-code'));

const claimNextTodo = async (project, assignee) => {
  const { withLock } = require('./lock');
  const candidates = getAllTasks(TASKS_DIR).filter((t) => isEligibleForWorker(t, project, assignee));
  for (const cand of candidates) {
    const claimed = await withLock(`task:${cand.id}`, async () => {
      const filePath = findTaskFilePath(cand.id);
      if (!filePath || !fs.existsSync(filePath)) return null;
      const parsed = matter(fs.readFileSync(filePath, 'utf-8'));
      if (parsed.data.status !== 'todo') return null; // raced — someone took it
      const now = new Date().toISOString();
      parsed.data.status = 'in_progress';
      parsed.data.assignee = assignee;
      parsed.data.started_at = parsed.data.started_at || now;
      parsed.data.activity_log = (parsed.data.activity_log || []).concat([
        { timestamp: now, action: `Status changed to IN PROGRESS by ${assignee}` },
        { timestamp: now, action: `assignee changed to ${assignee} (worker-loop claim)` },
      ]);
      trimActivityLog(cand.id, parsed.data);
      atomicWriteFileSync(filePath, matter.stringify(parsed.content, parsed.data));
      invalidateCache();
      indexSet(cand.id, filePath);
      const taskObj = { ...parsed.data, id: cand.id, content: parsed.content, project };
      try { const { getIO } = require('./io'); const io = getIO(); if (io) io.emit('task_updated', { ...taskObj, summary: generateSummary(taskObj) }); } catch { /* io not ready */ }
      return taskObj;
    });
    if (claimed) return claimed;
  }
  return null;
};

module.exports = { getAllTasks, findTaskFilePath, buildIndex, indexSet, indexDelete, invalidateCache, atomicWriteFileSync, cleanupTempFiles, trimActivityLog, getFullActivityLog, generateSummary, updateTaskField, appendComment, createTask, claimNextTodo, isEligibleForWorker };
