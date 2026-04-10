const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { TASKS_DIR, HISTORY_DIR } = require('./constants');
const { logger } = require('./logger');

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

      tasksArray.push({
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
        project: project,
        content: content.trim(),
        filePath: filePath
      });
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

module.exports = { getAllTasks, findTaskFilePath, buildIndex, indexSet, indexDelete, invalidateCache, atomicWriteFileSync, cleanupTempFiles, trimActivityLog, getFullActivityLog };
