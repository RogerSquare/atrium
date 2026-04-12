const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { TASKS_DIR, SETTINGS_FILE, USERS_DIR } = require('../lib/constants');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { getAllTasks, findTaskFilePath } = require('../lib/tasks');
const matter = require('gray-matter');
const { getIO } = require('../lib/io');
const { logger } = require('../lib/logger');

const router = express.Router();
const HISTORY_DIR = path.join(__dirname, '..', 'ai-history');

if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

const MAX_HISTORY = 20;

// --- System Prompt Builder ---
const buildPrompt = (userMessage, username, role, taskContext, history) => {
  const tasks = getAllTasks(TASKS_DIR);
  const statusCounts = { todo: 0, in_progress: 0, review: 0, done: 0 };
  tasks.forEach(t => { if (statusCounts[t.status] !== undefined) statusCounts[t.status]++; });

  const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done').slice(0, 8);
  const projects = fs.readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);

  let workDir;
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    workDir = settings.workingDirectory || process.cwd();
  } catch (e) { workDir = process.cwd(); }

  const lines = [];
  lines.push(`You are an AI assistant inside the Atrium task management system. You help users plan, create, and manage tasks.`);
  lines.push('');
  lines.push(`## Current User: ${username} (${role})`);
  lines.push('');
  lines.push(`## Board Overview`);
  lines.push(`- Total: ${tasks.length} tasks | Todo: ${statusCounts.todo} | In Progress: ${statusCounts.in_progress} | Review: ${statusCounts.review} | Done: ${statusCounts.done}`);
  lines.push(`- Projects: Root, ${projects.join(', ')}`);

  if (highPriority.length > 0) {
    lines.push('');
    lines.push('## High Priority Tasks');
    highPriority.forEach(t => lines.push(`- [${t.status}] ${t.id}: ${t.title}`));
  }

  if (taskContext) {
    lines.push('');
    lines.push(`## Current Task Context`);
    lines.push(`- **ID**: ${taskContext.id}`);
    lines.push(`- **Title**: ${taskContext.title}`);
    lines.push(`- **Status**: ${taskContext.status} | **Priority**: ${taskContext.priority} | **Type**: ${taskContext.type || 'fullstack'}`);
    lines.push(`- **Project**: ${taskContext.project} | **Assignee**: ${taskContext.assignee || 'Unassigned'}`);
    if (taskContext.component) lines.push(`- **Component**: ${taskContext.component}`);
    if (taskContext.tags?.length) lines.push(`- **Tags**: ${taskContext.tags.join(', ')}`);
    if (taskContext.parent_task) lines.push(`- **Parent Task**: ${taskContext.parent_task}`);
    if (taskContext.content) {
      lines.push('');
      lines.push('### Task Content');
      lines.push(taskContext.content);
    }
  }

  lines.push('');
  lines.push('## Task Management');
  lines.push(`You can manage tasks via the API at http://localhost:3001/api/tasks`);
  lines.push(`- To create a task: POST /api/tasks with JSON body {title, project, priority, type, content, created_by: "${username}"}`);
  lines.push(`- To update a task: PUT /api/tasks/{id} with fields to change`);
  lines.push('- Use status values: todo, in_progress, review (NOT done — only humans mark done)');
  lines.push('- Always include created_by or updated_by with the username');

  if (history.length > 0) {
    lines.push('');
    lines.push('## Conversation History');
    history.forEach(m => {
      lines.push(`**${m.role === 'user' ? username : 'Assistant'}**: ${m.content}`);
    });
  }

  lines.push('');
  lines.push(`## User Message`);
  lines.push(userMessage);

  return lines.join('\n');
};

// --- History Helpers ---
const getHistoryPath = (type, id) => {
  if (type === 'task') return path.join(HISTORY_DIR, `task-${id}.json`);
  return path.join(HISTORY_DIR, `${id}.json`);
};

const loadHistory = (type, id) => {
  const p = getHistoryPath(type, id);
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) {}
  return [];
};

const saveHistory = (type, id, messages) => {
  fs.writeFileSync(getHistoryPath(type, id), JSON.stringify(messages.slice(-MAX_HISTORY), null, 2));
};

// Track active AI chat sessions to prevent double-spawns
const activeSessions = new Map();

// --- Routes ---

/**
 * @swagger
 * /api/ai/chat:
 *   post:
 *     summary: Send a message to the AI assistant
 *     description: Spawns Claude CLI with Atrium context. Prevents concurrent sessions. 2-minute timeout.
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message, username]
 *             properties:
 *               message:
 *                 type: string
 *               username:
 *                 type: string
 *               role:
 *                 type: string
 *                 default: member
 *               taskId:
 *                 type: string
 *                 description: For task-specific context
 *               taskContext:
 *                 type: object
 *                 description: Task data to include in prompt
 *     responses:
 *       200:
 *         description: AI response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 response:
 *                   type: string
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, username, role, taskId, taskContext } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    // Check global AI chat toggle
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (settings.ai_chat_enabled === false) {
        return res.status(403).json({ error: 'AI Chat is disabled system-wide by an administrator' });
      }
    } catch (e) { /* allow if settings unreadable */ }

    // Check per-user AI chat permission
    if (username) {
      const safeUser = sanitizeFilename(username);
      const userFilePath = safeUser ? safePath(USERS_DIR, `${safeUser}.json`) : null;
      if (userFilePath && fs.existsSync(userFilePath)) {
        const userData = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
        if (userData.can_use_ai_chat === false) {
          return res.status(403).json({ error: 'You do not have permission to use AI Chat. Contact an administrator.' });
        }
      }
    }

    const sessionKey = taskId ? `task:${taskId}` : `user:${username}`;
    if (activeSessions.has(sessionKey)) {
      return res.status(409).json({ error: 'AI is still processing the previous message. Please wait.' });
    }

    const historyType = taskId ? 'task' : 'user';
    const historyId = taskId || username;
    const history = loadHistory(historyType, historyId);

    // Build the full prompt with context + history + user message
    const prompt = buildPrompt(message, username, role || 'member', taskContext || null, history);

    let workDir;
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      workDir = settings.workingDirectory || process.cwd();
    } catch (e) { workDir = process.cwd(); }

    // Spawn claude CLI
    activeSessions.set(sessionKey, true);

    const claude = spawn('claude', ['--print', '--dangerously-skip-permissions'], {
      cwd: workDir,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    claude.stdin.write(prompt);
    claude.stdin.end();

    let output = '';
    let errorOutput = '';

    claude.stdout.on('data', (data) => { output += data.toString(); });
    claude.stderr.on('data', (data) => { errorOutput += data.toString(); });

    claude.on('close', (code) => {
      activeSessions.delete(sessionKey);

      if (code !== 0 && !output) {
        return res.status(500).json({ error: errorOutput || `Claude exited with code ${code}` });
      }

      const response = output.trim();

      // Save to history
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: response });
      saveHistory(historyType, historyId, history);

      res.json({ response });
    });

    claude.on('error', (err) => {
      activeSessions.delete(sessionKey);
      res.status(500).json({ error: `Failed to start Claude CLI: ${err.message}` });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      if (activeSessions.has(sessionKey)) {
        claude.kill();
        activeSessions.delete(sessionKey);
      }
    }, 120000);

  } catch (error) {
    logger.error({ err: error }, 'AI chat error');
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/ai/history:
 *   get:
 *     summary: Get AI conversation history
 *     tags: [AI]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [task, user]
 *       - in: query
 *         name: taskId
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation messages (max 20)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   role:
 *                     type: string
 *                   content:
 *                     type: string
 */
router.get('/history', (req, res) => {
  const { type, taskId, username } = req.query;
  const historyType = type || (taskId ? 'task' : 'user');
  const historyId = taskId || username;
  if (!historyId) return res.json([]);
  res.json(loadHistory(historyType, historyId));
});

/**
 * @swagger
 * /api/ai/history:
 *   delete:
 *     summary: Clear AI conversation history
 *     tags: [AI]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *       - in: query
 *         name: taskId
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: History cleared
 */
router.delete('/history', (req, res) => {
  const { type, taskId, username } = req.query;
  const historyType = type || (taskId ? 'task' : 'user');
  const historyId = taskId || username;
  if (!historyId) return res.json({ success: true });
  const p = getHistoryPath(historyType, historyId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ success: true });
});

module.exports = router;
