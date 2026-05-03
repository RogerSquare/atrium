// Playwright e2e run artifact storage (feat-e2e-tests-tab-001).
// Per-task subdirectories under E2E_RUNS_DIR, each holding one run's files.
// Capped at MAX_E2E_RUNS_PER_TASK newest-first; older runs evicted on upload.
//
// Auth model: most endpoints use requireAuth (Authorization header).
// The file-serving GET also accepts ?token=<jwt> as a query-param fallback so
// browser <video>/<img> tags (which don't send custom headers) can fetch
// artifacts in the Tests tab.

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { E2E_RUNS_DIR, MAX_E2E_RUNS_PER_TASK } = require('../lib/constants');
const { requireAuth } = require('../lib/authMiddleware');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { logger } = require('../lib/logger');

const router = express.Router();

if (!fs.existsSync(E2E_RUNS_DIR)) fs.mkdirSync(E2E_RUNS_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 100 },
});

function tokenAuth(req, res, next) {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return requireAuth(req, res, next);
}

function safeTaskDir(taskId) {
  const safe = sanitizeFilename(taskId);
  if (!safe) return null;
  return safePath(E2E_RUNS_DIR, safe);
}

function listRuns(taskDir) {
  if (!fs.existsSync(taskDir)) return [];
  return fs.readdirSync(taskDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
}

function pruneOldRuns(taskDir) {
  const runs = listRuns(taskDir);
  for (const old of runs.slice(MAX_E2E_RUNS_PER_TASK)) {
    try {
      fs.rmSync(path.join(taskDir, old), { recursive: true, force: true });
    } catch (err) {
      logger.warn({ err, runDir: old }, 'pruneOldRuns: failed to delete');
    }
  }
}

// POST /api/e2e-runs/:task_id  — multipart upload of a run's files.
// Each file's `fieldname` is its relative path within the run directory.
router.post('/:task_id', requireAuth, upload.any(), (req, res) => {
  const taskDir = safeTaskDir(req.params.task_id);
  if (!taskDir) return res.status(400).json({ error: 'Invalid task id' });
  if (!Array.isArray(req.files) || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(taskDir, runId);
  fs.mkdirSync(runDir, { recursive: true });

  for (const f of req.files) {
    const segments = String(f.fieldname).replace(/\\/g, '/').split('/').filter(Boolean);
    if (segments.length === 0 || segments.some((s) => s === '..')) {
      return res.status(400).json({ error: 'Invalid file path', path: f.fieldname });
    }
    const target = path.join(runDir, ...segments);
    if (!target.startsWith(runDir + path.sep) && target !== runDir) {
      return res.status(400).json({ error: 'Invalid file path', path: f.fieldname });
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.buffer);
  }

  pruneOldRuns(taskDir);

  return res.status(201).json({ run_id: runId, files: req.files.length });
});

// GET /api/e2e-runs/:task_id  — list runs for a task (newest first, capped).
router.get('/:task_id', requireAuth, (req, res) => {
  const taskDir = safeTaskDir(req.params.task_id);
  if (!taskDir) return res.status(400).json({ error: 'Invalid task id' });
  const runs = listRuns(taskDir).slice(0, MAX_E2E_RUNS_PER_TASK).map((run_id) => {
    const stat = fs.statSync(path.join(taskDir, run_id));
    return { run_id, created_at: stat.birthtime || stat.mtime };
  });
  return res.json({ runs });
});

// DELETE /api/e2e-runs/:task_id/:run_id  — manual cleanup of a single run.
router.delete('/:task_id/:run_id', requireAuth, (req, res) => {
  const taskDir = safeTaskDir(req.params.task_id);
  if (!taskDir) return res.status(400).json({ error: 'Invalid task id' });
  const safeRun = sanitizeFilename(req.params.run_id);
  if (!safeRun) return res.status(400).json({ error: 'Invalid run id' });
  const runDir = path.join(taskDir, safeRun);
  if (!runDir.startsWith(taskDir + path.sep)) return res.status(400).json({ error: 'Invalid path' });
  if (!fs.existsSync(runDir)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(runDir, { recursive: true, force: true });
  return res.json({ success: true });
});

// GET /api/e2e-runs/:task_id/:run_id/files/*splat  — serve a run's artifact file.
// tokenAuth allows ?token=<jwt> for <video src> / <img src> tags.
// `*splat` is Express 5's named-wildcard syntax (path-to-regexp v8); bare `*`
// throws "Missing parameter name" — see CLAUDE.md "Express 5 / path-to-regexp" pitfall.
router.get('/:task_id/:run_id/files/*splat', tokenAuth, (req, res) => {
  const taskDir = safeTaskDir(req.params.task_id);
  if (!taskDir) return res.status(400).json({ error: 'Invalid task id' });
  const safeRun = sanitizeFilename(req.params.run_id);
  if (!safeRun) return res.status(400).json({ error: 'Invalid run id' });
  const splat = req.params.splat;
  const relPath = Array.isArray(splat) ? splat.join('/') : (splat || '');
  const target = path.normalize(path.join(taskDir, safeRun, relPath));
  const runDir = path.join(taskDir, safeRun);
  if (!target.startsWith(runDir + path.sep) && target !== runDir) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.sendFile(target);
});

module.exports = router;
