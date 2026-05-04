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

      const relativePath = path.relative(TASKS_DIR, dirPath);
      const project = relativePath || 'Root';
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

    const relativePath = path.relative(TASKS_DIR, path.dirname(filePath));
    const project = relativePath || 'Root';
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

module.exports = { getAllTasks, findTaskFilePath, buildIndex, indexSet, indexDelete, invalidateCache, atomicWriteFileSync, cleanupTempFiles, trimActivityLog, getFullActivityLog, generateSummary, updateTaskField };
