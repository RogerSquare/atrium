const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const matter = require('gray-matter');
const { TASKS_DIR, USERS_DIR, SETTINGS_FILE, INSTRUCTIONS_FILE } = require('../lib/constants');
const { getAllTasks, findTaskFilePath, atomicWriteFileSync } = require('../lib/tasks');
const { activeAgents, buildAgentPrompt } = require('../lib/agents');
const { withLock } = require('../lib/lock');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { logger } = require('../lib/logger');

const router = express.Router();

// Needs io passed in from server.js
let io = null;
const setIO = (socketIO) => { io = socketIO; };

/**
 * @swagger
 * /api/agents/active:
 *   get:
 *     summary: Get active agents
 *     tags: [Agents]
 *     responses:
 *       200:
 *         description: List of currently running agents
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   taskId:
 *                     type: string
 *                   startedAt:
 *                     type: string
 *                     format: date-time
 *                   startedBy:
 *                     type: string
 */
router.get('/active', (req, res) => {
  const agents = [];
  for (const [taskId, agent] of activeAgents.entries()) {
    agents.push({ taskId, startedAt: agent.startedAt, startedBy: agent.startedBy });
  }
  res.json(agents);
});

/**
 * @swagger
 * /api/agents/start:
 *   post:
 *     summary: Start an agent on a task
 *     description: Spawns a Claude agent for the given task. Checks system-wide agents_enabled setting and per-user can_run_agents permission. Auto-updates task status to in_progress.
 *     tags: [Agents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [taskId]
 *             properties:
 *               taskId:
 *                 type: string
 *                 example: feat-auth-001
 *               startedBy:
 *                 type: string
 *     responses:
 *       200:
 *         description: Agent started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 taskId:
 *                   type: string
 *                 startedAt:
 *                   type: string
 *                   format: date-time
 */
router.post('/start', async (req, res) => {
  try {
    const { taskId, startedBy } = req.body;
    if (!taskId) return res.status(400).json({ error: 'taskId required' });

    // Check global agents toggle
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      if (settings.agents_enabled === false) {
        return res.status(403).json({ error: 'Agents are disabled system-wide by an administrator' });
      }
    } catch (e) { /* allow if settings unreadable */ }

    // Check per-user agent permission
    if (startedBy) {
      const safeUser = sanitizeFilename(startedBy);
      const userFilePath = safeUser ? safePath(USERS_DIR, `${safeUser}.json`) : null;
      if (userFilePath && fs.existsSync(userFilePath)) {
        const userData = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
        if (userData.can_run_agents === false) {
          return res.status(403).json({ error: 'You do not have permission to run agents. Contact an administrator.' });
        }
      }
    }

    if (activeAgents.has(taskId)) {
      return res.status(409).json({ error: 'Agent already running on this task' });
    }

    const tasks = getAllTasks(TASKS_DIR);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    let instructions = '';
    try {
      instructions = fs.readFileSync(INSTRUCTIONS_FILE, 'utf-8');
    } catch (e) {
      instructions = '(instructions.md not found)';
    }

    let workDir;
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      workDir = settings.workingDirectory || process.cwd();
    } catch (e) {
      workDir = process.cwd();
    }

    const prompt = buildAgentPrompt(task, instructions);

    const safeTaskId = sanitizeFilename(taskId);
    const promptFile = path.join(__dirname, '..', `.agent-prompt-${safeTaskId}.txt`);
    fs.writeFileSync(promptFile, prompt);

    const agentProcess = spawn('claude', ['--print', '--dangerously-skip-permissions'], {
      cwd: workDir,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const promptContent = fs.readFileSync(promptFile, 'utf-8');
    agentProcess.stdin.write(promptContent);
    agentProcess.stdin.end();

    const agentInfo = {
      process: agentProcess,
      startedAt: new Date().toISOString(),
      startedBy: startedBy || 'Unknown',
      promptFile
    };
    activeAgents.set(taskId, agentInfo);

    const emitOutput = (data) => {
      if (io) io.emit('agent_output', { taskId, data: data.toString() });
    };

    agentProcess.stdout.on('data', emitOutput);
    agentProcess.stderr.on('data', emitOutput);

    agentProcess.on('close', (code) => {
      activeAgents.delete(taskId);
      try { fs.unlinkSync(promptFile); } catch (e) {}
      if (io) io.emit('agent_complete', { taskId, exitCode: code });
      logger.info({ taskId, exitCode: code }, 'Agent process completed');
    });

    agentProcess.on('error', (err) => {
      activeAgents.delete(taskId);
      try { fs.unlinkSync(promptFile); } catch (e) {}
      if (io) io.emit('agent_error', { taskId, error: err.message });
      logger.error({ err, taskId }, 'Agent process error');
    });

    // Auto-update task to in_progress (locked to prevent race with concurrent task updates)
    await withLock(`task:${taskId}`, async () => {
      const now = new Date().toISOString();
      const filePath = findTaskFilePath(taskId);
      if (filePath && fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const parsed = matter(fileContent);
        if (parsed.data.status !== 'in_progress') {
          parsed.data.status = 'in_progress';
          if (!parsed.data.started_at) parsed.data.started_at = now;
          parsed.data.assignee = startedBy || parsed.data.assignee || 'Agent';
          parsed.data.activity_log = parsed.data.activity_log || [];
          parsed.data.activity_log.push({ timestamp: now, action: `Agent started by ${startedBy || 'User'}` });
          atomicWriteFileSync(filePath, matter.stringify(parsed.content, parsed.data));
        }
      }
    });

    res.json({ success: true, taskId, startedAt: agentInfo.startedAt });
  } catch (error) {
    logger.error({ err: error }, 'Agent start failed');
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/agents/{taskId}/stop:
 *   post:
 *     summary: Stop a running agent
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Agent stopped
 */
router.post('/:taskId/stop', (req, res) => {
  const { taskId } = req.params;
  const agent = activeAgents.get(taskId);
  if (!agent) return res.status(404).json({ error: 'No active agent for this task' });

  try {
    agent.process.kill();
    activeAgents.delete(taskId);
    try { fs.unlinkSync(agent.promptFile); } catch (e) {}
    if (io) io.emit('agent_complete', { taskId, exitCode: null, stopped: true });
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, setIO };
