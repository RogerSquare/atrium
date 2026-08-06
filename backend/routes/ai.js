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
  // Registry, not a readdir: under the nested layout the top-level dirs are
  // WORKSPACES, not projects.
  const projects = Object.values(require('../lib/projectRegistry').getAll({ include: 'active' }))
    .map(p => p.folder).filter(f => f !== 'Root');

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

const aiSessions = require('../lib/aiChatSessions');

// Idle timeout: kill a generation only when claude has produced nothing for
// this long. The old flat 2-minute cap killed legitimately long agentic runs;
// idle-based keeps the same protection against a hung process.
const IDLE_TIMEOUT_MS = 120000;

// proc was spawned with shell:true, so proc.pid is the shell — on Windows
// killing it orphans the actual claude process. taskkill /T takes the tree.
const killTree = (proc) => {
  if (!proc || proc.killed) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']); } catch { /* already gone */ }
  } else {
    try { proc.kill('SIGTERM'); } catch { /* already gone */ }
  }
};

// --- Routes ---

// Run one claude generation for a session, streaming parsed text into the
// session buffer and the thread's socket room. Split out of the route so the
// no-partial-flag retry can re-enter it cleanly.
const runGeneration = ({ sessionKey, prompt, workDir, historyType, historyId, message, allowPartialFlag }) => {
  const session = aiSessions.get(sessionKey);
  if (!session) return;

  const room = aiSessions.roomForKey(sessionKey);
  const emit = (event, payload) => {
    const io = getIO();
    if (io) io.to(room).emit(event, { key: sessionKey, ...payload });
  };

  const args = ['--print', '--verbose', '--output-format', 'stream-json'];
  if (allowPartialFlag) args.push('--include-partial-messages');
  args.push('--dangerously-skip-permissions');

  const claude = spawn('claude', args, {
    cwd: workDir,
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  session.proc = claude;

  claude.stdin.write(prompt);
  claude.stdin.end();

  let rawStdout = '';
  let errorOutput = '';

  const parser = aiSessions.createStreamParser({
    currentBuffer: () => aiSessions.get(sessionKey)?.buffer || '',
    onDelta: (text) => {
      aiSessions.appendText(sessionKey, text);
      emit('ai_chat_chunk', { text });
    },
    onMessage: (text) => {
      const sep = (aiSessions.get(sessionKey)?.buffer || '') ? '\n\n' : '';
      aiSessions.appendText(sessionKey, sep + text);
      emit('ai_chat_chunk', { text: sep + text });
    },
    onResult: (text) => {
      // The result event is the canonical final answer (intermediate turn
      // text is progress narration) — replace, matching what history saves.
      aiSessions.replaceText(sessionKey, text);
      emit('ai_chat_chunk', { replace: text });
    },
  });

  // Idle-based watchdog: any output resets the clock.
  let idleTimer = null;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.warn({ sessionKey }, 'AI chat generation idle timeout — killing');
      killTree(claude);
    }, IDLE_TIMEOUT_MS);
  };
  resetIdle();

  claude.stdout.on('data', (data) => {
    const text = data.toString();
    rawStdout += text;
    parser.write(text);
    resetIdle();
  });
  claude.stderr.on('data', (data) => { errorOutput += data.toString(); resetIdle(); });

  claude.on('close', (code) => {
    clearTimeout(idleTimer);
    parser.flush();
    const current = aiSessions.get(sessionKey);
    if (!current) return; // stop endpoint already finalized

    // Older CLI without --include-partial-messages: bail before any output
    // and retry once without the flag.
    if (
      code !== 0 && allowPartialFlag && !current.buffer && !parser.parsedAnyEvent()
      && /include-partial-messages|unknown option|unexpected argument/i.test(errorOutput)
    ) {
      logger.warn({ sessionKey }, 'claude CLI rejected --include-partial-messages — retrying without it');
      runGeneration({ sessionKey, prompt, workDir, historyType, historyId, message, allowPartialFlag: false });
      return;
    }

    // Plain-text fallback: process wrote output but nothing parsed as
    // stream-json (e.g. an old CLI ignoring --output-format).
    if (!current.buffer && !parser.parsedAnyEvent() && rawStdout.trim()) {
      aiSessions.replaceText(sessionKey, rawStdout.trim());
    }

    const finished = aiSessions.get(sessionKey);
    const response = (finished.buffer || '').trim();

    if (finished.cancelled) {
      aiSessions.finish(sessionKey, { status: 'cancelled' });
      if (response) {
        const history = loadHistory(historyType, historyId);
        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: response, cancelled: true });
        saveHistory(historyType, historyId, history);
      }
      emit('ai_chat_done', { response, cancelled: true });
      return;
    }

    if (code !== 0 && !response) {
      aiSessions.finish(sessionKey, { status: 'error', error: errorOutput });
      emit('ai_chat_error', { error: errorOutput.trim() || `Claude exited with code ${code}` });
      return;
    }

    if (!response) {
      aiSessions.finish(sessionKey, { status: 'error', error: 'Empty response' });
      emit('ai_chat_error', { error: 'Claude returned an empty response.' });
      return;
    }

    aiSessions.finish(sessionKey, { status: 'done' });
    const history = loadHistory(historyType, historyId);
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: response });
    saveHistory(historyType, historyId, history);
    emit('ai_chat_done', { response, cancelled: false });
  });

  claude.on('error', (err) => {
    clearTimeout(idleTimer);
    if (!aiSessions.get(sessionKey)) return;
    aiSessions.finish(sessionKey, { status: 'error', error: err.message });
    emit('ai_chat_error', { error: `Failed to start Claude CLI: ${err.message}` });
  });
};

/**
 * @swagger
 * /api/ai/chat:
 *   post:
 *     summary: Send a message to the AI assistant (streamed)
 *     description: >
 *       Spawns Claude CLI with Atrium context and returns 202 immediately.
 *       The response streams over Socket.IO to the thread's room
 *       (join via the `ai_chat_join` event) as `ai_chat_chunk` /
 *       `ai_chat_done` / `ai_chat_error` events. One generation per thread
 *       at a time; 409 while one is in flight (attach instead via
 *       GET /api/ai/stream or the socket join ack).
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
 *       202:
 *         description: Generation started; stream over Socket.IO
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 streaming:
 *                   type: boolean
 *                 key:
 *                   type: string
 *       409:
 *         description: A generation is already in flight for this thread
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
    if (aiSessions.isRunning(sessionKey)) {
      // Not an error state for the UI anymore — the client should attach to
      // the in-flight stream (socket join ack / GET /stream) instead of
      // re-sending. 409 still guards the actual double-send.
      return res.status(409).json({
        error: 'AI is still processing the previous message.',
        streaming: true,
        session: aiSessions.snapshot(sessionKey),
      });
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

    aiSessions.createSession(sessionKey, { userMessage: message });
    runGeneration({ sessionKey, prompt, workDir, historyType, historyId, message, allowPartialFlag: true });

    res.status(202).json({ streaming: true, key: sessionKey });
  } catch (error) {
    logger.error({ err: error }, 'AI chat error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/ai/stream:
 *   get:
 *     summary: Snapshot of the in-flight AI generation for a thread
 *     description: Returns the accumulated buffer of a running generation, or session=null when idle. Used to re-attach after a refresh.
 *     tags: [AI]
 *     parameters:
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
 *         description: Current session snapshot or null
 */
router.get('/stream', (req, res) => {
  const { taskId, username } = req.query;
  if (!taskId && !username) return res.status(400).json({ error: 'taskId or username required' });
  const sessionKey = taskId ? `task:${taskId}` : `user:${username}`;
  res.json({ session: aiSessions.snapshot(sessionKey) });
});

/**
 * @swagger
 * /api/ai/chat/stop:
 *   post:
 *     summary: Cancel the in-flight AI generation for a thread
 *     description: Kills the spawned Claude process. The partial response is persisted to history with a cancelled marker and broadcast via ai_chat_done.
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               taskId:
 *                 type: string
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cancellation requested (idempotent — ok even if nothing was running)
 */
router.post('/chat/stop', (req, res) => {
  const { taskId, username } = req.body || {};
  if (!taskId && !username) return res.status(400).json({ error: 'taskId or username required' });
  const sessionKey = taskId ? `task:${taskId}` : `user:${username}`;
  const session = aiSessions.get(sessionKey);
  if (!session || session.status !== 'running') {
    return res.json({ stopped: false });
  }
  aiSessions.markCancelled(sessionKey);
  killTree(session.proc);
  res.json({ stopped: true });
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
