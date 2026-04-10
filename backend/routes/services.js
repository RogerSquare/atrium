const express = require('express');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { getServices, saveServices, checkPort } = require('../lib/services');
const { getIO } = require('../lib/io');
const { logger } = require('../lib/logger');

const router = express.Router();

// --- In-memory log + process tracking ---
// Map<serviceId, { process, logs: string[], startedAt, pid }>
const runningServices = new Map();
const MAX_LOG_LINES = 500;

const appendLog = (serviceId, data) => {
  const entry = runningServices.get(serviceId);
  if (!entry) return;

  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (line.trim()) {
      entry.logs.push(line);
      if (entry.logs.length > MAX_LOG_LINES) entry.logs.shift();
    }
  }

  const io = getIO();
  if (io) io.emit('service_log', { serviceId, data: data.toString() });
};

// --- Validation Helpers ---

const ALLOWED_COMMANDS = ['npm', 'node', 'python', 'python3', 'pip', 'pip3', 'npx', 'yarn', 'pnpm', 'deno', 'bun', 'cargo', 'go', 'java', 'dotnet'];
const SHELL_OPERATORS = /[;|&`$(){}><\n\r]/;

const validatePort = (port) => {
  const num = parseInt(port);
  return Number.isInteger(num) && num >= 1 && num <= 65535 ? num : null;
};

const validateStartCmd = (cmd) => {
  if (!cmd || typeof cmd !== 'string') return { valid: false, error: 'Start command required' };
  if (SHELL_OPERATORS.test(cmd)) return { valid: false, error: 'Start command contains disallowed shell operators' };
  const baseCmd = cmd.trim().split(/\s+/)[0].toLowerCase().replace('.cmd', '').replace('.exe', '');
  if (!ALLOWED_COMMANDS.includes(baseCmd)) return { valid: false, error: `Command "${baseCmd}" is not in the allowed list: ${ALLOWED_COMMANDS.join(', ')}` };
  return { valid: true };
};

const validateCwd = (cwd) => {
  if (!cwd || typeof cwd !== 'string') return false;
  try { return fs.existsSync(cwd) && fs.statSync(cwd).isDirectory(); } catch (e) { return false; }
};

const stopByPort = (port, callback) => {
  const safePort = validatePort(port);
  if (!safePort) return callback(new Error('Invalid port'));
  const cmd = `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${safePort} ^| findstr LISTENING') do taskkill /F /PID %a`;
  exec(cmd, callback);
};

const startService = (service) => {
  const parts = service.startCmd.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  const WINDOWS_CMD_TOOLS = ['npm', 'npx', 'yarn', 'pnpm', 'bun'];
  const finalCmd = (process.platform === 'win32' && WINDOWS_CMD_TOOLS.includes(cmd))
    ? cmd + '.cmd'
    : cmd;

  const useShell = process.platform === 'win32';
  const child = spawn(finalCmd, args, {
    cwd: service.cwd,
    detached: !useShell,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
    windowsHide: true
  });

  // Track the process and capture logs
  const entry = {
    process: child,
    logs: [],
    startedAt: new Date().toISOString(),
    pid: child.pid
  };
  runningServices.set(service.id, entry);

  child.stdout.on('data', (data) => appendLog(service.id, data));
  child.stderr.on('data', (data) => appendLog(service.id, data));

  child.on('close', (code) => {
    appendLog(service.id, `\n--- Process exited with code ${code} ---\n`);
    // Keep logs but remove process reference
    const e = runningServices.get(service.id);
    if (e) { e.process = null; e.pid = null; }
  });

  child.on('error', (err) => {
    appendLog(service.id, `\n--- Error: ${err.message} ---\n`);
  });

  child.unref();
  return child;
};

// Topological sort — returns services in dependency order
const topoSort = (services) => {
  const graph = new Map();
  const inDegree = new Map();
  services.forEach(s => { graph.set(s.id, []); inDegree.set(s.id, 0); });

  services.forEach(s => {
    (s.depends_on || []).forEach(depId => {
      if (graph.has(depId)) {
        graph.get(depId).push(s.id);
        inDegree.set(s.id, (inDegree.get(s.id) || 0) + 1);
      }
    });
  });

  const queue = [];
  inDegree.forEach((deg, id) => { if (deg === 0) queue.push(id); });

  const sorted = [];
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    (graph.get(id) || []).forEach(neighbor => {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) queue.push(neighbor);
    });
  }

  // If cycle detected, return original order
  if (sorted.length !== services.length) return services;
  return sorted.map(id => services.find(s => s.id === id));
};

// Start services in dependency order with delays
const startInOrder = async (services) => {
  const ordered = topoSort(services);
  for (const service of ordered) {
    const isRunning = await checkPort(service.port);
    if (!isRunning) {
      try { startService(service); } catch (e) { logger.error({ err: e, serviceId: service.id }, `Failed to start service ${service.name}`); }
      // Brief delay between starts to let dependencies initialize
      await new Promise(r => setTimeout(r, 1000));
    }
  }
};

// --- Routes ---

/**
 * @swagger
 * /api/services:
 *   get:
 *     summary: Get all registered services
 *     tags: [Services]
 *     responses:
 *       200:
 *         description: List of services with runtime status
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Service'
 */
router.get('/', async (req, res) => {
  try {
    const services = getServices();
    const serviceStatus = await Promise.all(services.map(async (s) => {
      const isRunning = await checkPort(s.port);
      const tracked = runningServices.get(s.id);
      return {
        ...s,
        status: isRunning ? 'running' : 'stopped',
        pid: tracked?.pid || null,
        startedAt: tracked?.startedAt || null,
        hasLogs: tracked ? tracked.logs.length > 0 : false
      };
    }));
    res.json(serviceStatus);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/services:
 *   post:
 *     summary: Register a new service
 *     tags: [Services]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, port, cwd, startCmd]
 *             properties:
 *               name:
 *                 type: string
 *                 example: My API Server
 *               port:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 65535
 *                 example: 3002
 *               cwd:
 *                 type: string
 *                 example: C:\Projects\my-api
 *               startCmd:
 *                 type: string
 *                 example: npm run dev
 *               group:
 *                 type: string
 *                 default: Uncategorized
 *               depends_on:
 *                 type: array
 *                 items:
 *                   type: string
 *               preview:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Service registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Service'
 */
router.post('/', (req, res) => {
  try {
    const { name, port, cwd, startCmd, group, depends_on, preview } = req.body;
    if (!name || !port || !cwd || !startCmd) return res.status(400).json({ error: 'Missing service information' });
    const safePort = validatePort(port);
    if (!safePort) return res.status(400).json({ error: 'Port must be a number between 1 and 65535' });
    const cmdCheck = validateStartCmd(startCmd);
    if (!cmdCheck.valid) return res.status(400).json({ error: cmdCheck.error });
    if (!validateCwd(cwd)) return res.status(400).json({ error: 'Working directory does not exist or is not a directory' });

    const services = getServices();
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const newService = { id, name, group: group || 'Uncategorized', port: safePort, cwd, startCmd: startCmd.trim(), depends_on: depends_on || [] };
    if (preview !== undefined) newService.preview = !!preview;
    services.push(newService);
    saveServices(services);
    res.status(201).json(newService);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/services/{id}:
 *   put:
 *     summary: Update a service
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               port:
 *                 type: integer
 *               cwd:
 *                 type: string
 *               startCmd:
 *                 type: string
 *               group:
 *                 type: string
 *               depends_on:
 *                 type: array
 *                 items:
 *                   type: string
 *               preview:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Service updated
 */
router.put('/:id', (req, res) => {
  try {
    const services = getServices();
    const idx = services.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Service not found' });
    const { name, port, cwd, startCmd, group, depends_on, preview } = req.body;

    if (port !== undefined) { const p = validatePort(port); if (!p) return res.status(400).json({ error: 'Invalid port' }); services[idx].port = p; }
    if (startCmd !== undefined) { const c = validateStartCmd(startCmd); if (!c.valid) return res.status(400).json({ error: c.error }); services[idx].startCmd = startCmd.trim(); }
    if (cwd !== undefined) { if (!validateCwd(cwd)) return res.status(400).json({ error: 'Invalid working directory' }); services[idx].cwd = cwd; }
    if (name !== undefined) services[idx].name = name;
    if (group !== undefined) services[idx].group = group;
    if (depends_on !== undefined) services[idx].depends_on = depends_on;
    if (preview !== undefined) services[idx].preview = !!preview;
    saveServices(services);
    res.json({ success: true, service: services[idx] });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/services/{id}/restart:
 *   post:
 *     summary: Restart a service
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service restarted
 */
router.post('/:id/restart', async (req, res) => {
  const services = getServices();
  const service = services.find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  stopByPort(service.port, () => {
    setTimeout(() => {
      try { startService(service); res.json({ success: true }); }
      catch (err) { res.status(500).json({ error: err.message }); }
    }, 1500);
  });
});

/**
 * @swagger
 * /api/services/{id}:
 *   delete:
 *     summary: Delete a service
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service deleted
 */
router.delete('/:id', (req, res) => {
  try {
    let services = getServices();
    services = services.filter(s => s.id !== req.params.id);
    saveServices(services);
    runningServices.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/services/{id}/stop:
 *   post:
 *     summary: Stop a running service
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service stopped
 */
router.post('/:id/stop', async (req, res) => {
  const services = getServices();
  const service = services.find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  stopByPort(service.port, () => res.json({ success: true }));
});

/**
 * @swagger
 * /api/services/{id}/start:
 *   post:
 *     summary: Start a service
 *     description: Checks that dependencies are running before starting.
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service started
 */
router.post('/:id/start', async (req, res) => {
  const services = getServices();
  const service = services.find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const isRunning = await checkPort(service.port);
  if (isRunning) return res.json({ success: true, message: 'Already running' });

  // Check dependencies are running
  if (service.depends_on && service.depends_on.length > 0) {
    for (const depId of service.depends_on) {
      const dep = services.find(s => s.id === depId);
      if (dep) {
        const depRunning = await checkPort(dep.port);
        if (!depRunning) {
          return res.status(400).json({ error: `Dependency "${dep.name}" (port ${dep.port}) is not running. Start it first.` });
        }
      }
    }
  }

  try { startService(service); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Get logs for a service
/**
 * @swagger
 * /api/services/{id}/logs:
 *   get:
 *     summary: Get service logs
 *     description: Returns up to 500 cached log lines.
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Log lines
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/:id/logs', (req, res) => {
  const entry = runningServices.get(req.params.id);
  res.json({ logs: entry ? entry.logs : [] });
});

// Clear logs for a service
/**
 * @swagger
 * /api/services/{id}/logs:
 *   delete:
 *     summary: Clear service logs
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Logs cleared
 */
router.delete('/:id/logs', (req, res) => {
  const entry = runningServices.get(req.params.id);
  if (entry) entry.logs = [];
  res.json({ success: true });
});

/**
 * @swagger
 * /api/services/groups/{name}/start:
 *   post:
 *     summary: Start all services in a group
 *     description: Starts services in dependency order with 1-second delays.
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group started
 */
router.post('/groups/:name/start', async (req, res) => {
  try {
    const services = getServices().filter(s => s.group === req.params.name);
    await startInOrder(services);
    res.json({ success: true });
  } catch (error) { logger.error({ err: error }, 'Request failed'); res.status(500).json({ error: 'Internal server error' }); }
});

/**
 * @swagger
 * /api/services/groups/{name}/stop:
 *   post:
 *     summary: Stop all services in a group
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group stopped
 */
router.post('/groups/:name/stop', async (req, res) => {
  try {
    const services = getServices().filter(s => s.group === req.params.name);
    for (const service of services) { stopByPort(service.port, () => {}); }
    res.json({ success: true });
  } catch (error) { logger.error({ err: error }, 'Request failed'); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
