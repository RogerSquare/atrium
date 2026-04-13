const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const matter = require('gray-matter');
const { APPROVALS_DIR } = require('../lib/constants');
const { findTaskFilePath, atomicWriteFileSync, invalidateCache, generateSummary } = require('../lib/tasks');
const { withLock } = require('../lib/lock');
const { getIO } = require('../lib/io');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { logger } = require('../lib/logger');

const router = express.Router();

// Ensure the approvals root directory exists at boot
if (!fs.existsSync(APPROVALS_DIR)) {
  try { fs.mkdirSync(APPROVALS_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

// Resolve and ensure the per-task approvals directory exists
function approvalsDirFor(taskId) {
  const safeId = sanitizeFilename(taskId);
  if (!safeId) return null;
  const dir = safePath(APPROVALS_DIR, safeId);
  if (!dir) return null;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readApprovals(taskId) {
  const dir = approvalsDirFor(taskId);
  if (!dir) return [];
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch (e) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function updateTaskStatus(taskId, newStatus, actor, actionText) {
  const filePath = findTaskFilePath(taskId);
  if (!filePath) return null;
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = matter(fileContent);
  const data = parsed.data || {};
  const now = new Date().toISOString();
  const fromStatus = data.status || 'todo';
  data.status = newStatus;
  data.activity_log = Array.isArray(data.activity_log) ? data.activity_log : [];
  data.activity_log.push({ timestamp: now, action: actionText || `Status changed from ${fromStatus} to ${newStatus} by ${actor}` });
  const newFile = matter.stringify(parsed.content, data);
  atomicWriteFileSync(filePath, newFile);
  invalidateCache();
  try {
    // Emit the same event shape other routes use so useTasks picks it up
    const fullTask = { id: taskId, ...data, content: parsed.content };
    fullTask.summary = generateSummary(fullTask);
    getIO()?.emit('task_updated', fullTask);
  } catch (e) { /* socket optional */ }
  return { id: taskId, status: newStatus, from: fromStatus };
}

// GET /api/approvals/task/:taskId — list all approvals for a task
router.get('/task/:taskId', (req, res) => {
  try {
    const approvals = readApprovals(req.params.taskId);
    res.json({ approvals });
  } catch (err) {
    logger.error({ err }, 'Failed to list approvals');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/approvals/task/:taskId — agent creates an approval request, task → waiting_input
router.post('/task/:taskId', async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const filePath = findTaskFilePath(taskId);
    if (!filePath) return res.status(404).json({ error: 'Task not found' });

    const { prompt, context = {}, options = [] } = req.body || {};
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt is required' });
    if (!Array.isArray(options) || options.length === 0) return res.status(400).json({ error: 'options must be a non-empty array' });

    const actor = req.user?.username || req.body?.created_by || 'agent';
    const id = `approval-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const approval = {
      id,
      task_id: taskId,
      created_at: new Date().toISOString(),
      created_by: actor,
      prompt: String(prompt).slice(0, 4000),
      context: typeof context === 'object' && context !== null ? context : {},
      options: options.map(o => String(o).slice(0, 200)),
      response: null,
      responded_at: null,
      responded_by: null,
    };

    await withLock(`approvals:${taskId}`, async () => {
      const dir = approvalsDirFor(taskId);
      if (!dir) throw new Error('Invalid task id');
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(approval, null, 2));
    });

    await withLock(`task:${taskId}`, async () => {
      updateTaskStatus(taskId, 'waiting_input', actor, `Approval requested by ${actor}: ${approval.prompt.slice(0, 80)}`);
    });

    try { getIO()?.emit('approvalCreated', { taskId, approval }); } catch (e) {}
    res.status(201).json({ approval });
  } catch (err) {
    logger.error({ err }, 'Failed to create approval');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/approvals/task/:taskId/:approvalId/respond — human responds, task → in_progress
router.post('/task/:taskId/:approvalId/respond', async (req, res) => {
  try {
    const { taskId, approvalId } = req.params;
    const { response } = req.body || {};
    if (!response || typeof response !== 'string') return res.status(400).json({ error: 'response is required' });

    const dir = approvalsDirFor(taskId);
    if (!dir) return res.status(400).json({ error: 'Invalid task id' });

    const filePath = safePath(dir, `${sanitizeFilename(approvalId)}.json`);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Approval not found' });

    const actor = req.user?.username || 'human';

    await withLock(`approvals:${taskId}`, async () => {
      const approval = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (approval.response) {
        const err = new Error('Already responded');
        err.code = 409;
        throw err;
      }
      if (!approval.options.includes(response)) {
        const err = new Error(`Response must be one of: ${approval.options.join(', ')}`);
        err.code = 400;
        throw err;
      }
      approval.response = response;
      approval.responded_at = new Date().toISOString();
      approval.responded_by = actor;
      fs.writeFileSync(filePath, JSON.stringify(approval, null, 2));
    });

    await withLock(`task:${taskId}`, async () => {
      updateTaskStatus(taskId, 'in_progress', actor, `Approval "${approvalId}" answered with "${response}" by ${actor}`);
    });

    try { getIO()?.emit('approvalAnswered', { taskId, approvalId, response, responded_by: actor }); } catch (e) {}
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 409) return res.status(409).json({ error: err.message });
    if (err.code === 400) return res.status(400).json({ error: err.message });
    logger.error({ err }, 'Failed to respond to approval');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
