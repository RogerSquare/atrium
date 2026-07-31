const express = require('express');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { getServices, saveServices, checkPort } = require('../lib/services');
const { getIO } = require('../lib/io');
const { logger } = require('../lib/logger');
const { servicesEnabled, SERVICES_DISABLED_REASON } = require('../lib/features');
const {
  dockerConfigured, inspectContainer, containerAction, containerLogs,
  isContainerService, containerNameFor,
} = require('../lib/dockerServices');
const { SETTINGS_FILE } = require('../lib/constants');
const { SURFACES, HEALTHCHECKS, portRequired, resolveStatus } = require('../lib/serviceModel');

const router = express.Router();

// --- Feature gate (devops-docker-flags-001) ---
// The Services manager spawns processes on the HOST by absolute path, which a
// container cannot do. When ATRIUM_FEATURE_SERVICES is off, every mutating
// route answers 501 with a reason instead of failing obscurely.
//
// GET / is deliberately NOT gated this way — it returns an empty list instead
// (see the route). Both Sidebar.jsx and ProjectProgress.jsx already render
// their Services section only when the list is non-empty, so an empty array
// makes the UI hide itself with no client changes and no empty-state flicker.
const requireServicesEnabled = (req, res, next) => {
  if (servicesEnabled()) return next();
  logger.info({ method: req.method, path: req.originalUrl }, 'services: rejected — feature disabled');
  return res.status(501).json({
    error: 'Services manager disabled',
    reason: SERVICES_DISABLED_REASON,
    feature: 'services',
  });
};

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

// Base allow-list for host-process start commands. Thick-client + build tools
// (swift/xcodebuild/make/…) are here so a Swift or native app can be registered
// at all (feat-service-surfaces-001). An admin can add more via an
// `allowed_commands` array in settings.json — no code change.
const ALLOWED_COMMANDS = [
  'npm', 'node', 'python', 'python3', 'pip', 'pip3', 'npx', 'yarn', 'pnpm', 'deno', 'bun',
  'cargo', 'go', 'java', 'dotnet',
  'swift', 'xcodebuild', 'make', 'cmake', 'ctest', 'gradle', 'mvn', 'dart', 'flutter',
];
const SHELL_OPERATORS = /[;|&`$(){}><\n\r]/;

// Base list plus any admin-configured extras from settings.json.
const allowedCommands = () => {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    const extra = Array.isArray(settings.allowed_commands) ? settings.allowed_commands : [];
    return [...new Set([...ALLOWED_COMMANDS, ...extra.map((c) => String(c).toLowerCase())])];
  } catch {
    return ALLOWED_COMMANDS;
  }
};

const validatePort = (port) => {
  const num = parseInt(port);
  return Number.isInteger(num) && num >= 1 && num <= 65535 ? num : null;
};

const validateStartCmd = (cmd) => {
  if (!cmd || typeof cmd !== 'string') return { valid: false, error: 'Start command required' };
  if (SHELL_OPERATORS.test(cmd)) return { valid: false, error: 'Start command contains disallowed shell operators' };
  const allowed = allowedCommands();
  const baseCmd = cmd.trim().split(/\s+/)[0].toLowerCase().replace('.cmd', '').replace('.exe', '');
  if (!allowed.includes(baseCmd)) return { valid: false, error: `Command "${baseCmd}" is not in the allowed list: ${allowed.join(', ')}` };
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
    windowsHide: true,
    // Per-service env overlay (feat-service-surfaces-001) — merged over the
    // backend's own env so a service can carry its own configuration.
    env: { ...process.env, ...(service.env && typeof service.env === 'object' ? service.env : {}) },
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
    // Keep logs but remove the process reference. Record the exit so a `job`
    // surface can report succeeded/failed after it finishes (serviceModel).
    const e = runningServices.get(service.id);
    if (e) { e.process = null; e.pid = null; e.lastExitCode = code; e.exitedAt = new Date().toISOString(); }
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

// --- Container-vs-process dispatch (feat-services-containers-001) ---
//
// A service entry is now polymorphic. `type: "container"` is driven through
// the Docker Engine API; anything else (including every legacy entry, which
// has no `type` at all) keeps the original host-spawn path. That is what makes
// this change safe for an existing services.json.
//
// Returns null when the service is NOT container-backed, so callers fall
// through to their existing process logic untouched.
const dockerDispatch = async (service, action) => {
  if (!isContainerService(service)) return null;
  const name = containerNameFor(service);

  if (!dockerConfigured()) {
    return {
      code: 501,
      payload: {
        error: 'Docker API unavailable',
        reason: `Service "${service.id}" is container-backed, but this instance has no Docker API configured (DOCKER_HOST unset). Start Atrium with the docker-services compose override.`,
      },
    };
  }

  if (action === 'logs') {
    const r = await containerLogs(name);
    return r.ok
      ? { code: 200, payload: { logs: r.logs } }
      : { code: 404, payload: { error: r.error } };
  }

  const r = await containerAction(name, action);
  if (!r.ok) return { code: 400, payload: { error: r.error } };
  return {
    code: 200,
    payload: { success: true, ...(r.alreadyInState ? { message: `Already ${action}ed` } : {}) },
  };
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
    // Disabled: answer with an EMPTY ARRAY, not an error object. The shape has
    // to stay an array — App.jsx and AppShell.jsx feed this straight into
    // state that is later .map()ed, so an object here would throw in the UI.
    // Empty also makes the Services sections in Sidebar.jsx and
    // ProjectProgress.jsx hide themselves, since both already guard on
    // `projectServices.length > 0`. The header carries the *reason* so the
    // disabled state stays discoverable in devtools and by any future client
    // that wants to distinguish "off" from "none registered".
    if (!servicesEnabled()) {
      res.set('X-Atrium-Feature-Services', 'disabled');
      return res.json([]);
    }

    const services = getServices();
    const serviceStatus = await Promise.all(services.map(async (s) => {
      // Container-backed: ask Docker. Its container state and published port
      // are authoritative — a host checkPort would report "running" for
      // whatever else happens to hold that port.
      if (isContainerService(s)) {
        if (!dockerConfigured()) {
          return { ...s, status: 'unavailable', pid: null, startedAt: null, hasLogs: false,
            reason: 'Docker API not configured' };
        }
        const info = await inspectContainer(containerNameFor(s));
        return {
          ...s,
          status: info.found ? info.status : 'stopped',
          port: info.found && info.port ? info.port : s.port,
          pid: info.found ? info.pid : null,
          startedAt: info.found ? info.startedAt : null,
          hasLogs: info.found,
          ...(info.found ? {} : { reason: 'Container does not exist yet' }),
        };
      }

      // Probe the network only for surfaces whose health is a port (web/server/
      // legacy); desktop/cli/job resolve from the tracked process instead
      // (feat-service-surfaces-001).
      const reachable = portRequired(s) ? await checkPort(s.port) : false;
      const tracked = runningServices.get(s.id);
      return {
        ...s,
        status: resolveStatus(s, { reachable, tracked }),
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
router.post('/', requireServicesEnabled, (req, res) => {
  try {
    const { name, port, cwd, startCmd, group, depends_on, preview, type, container_name, surface, healthcheck, env, autostart } = req.body;
    if (!name) return res.status(400).json({ error: 'Service name is required' });
    if (surface !== undefined && !SURFACES.includes(surface)) {
      return res.status(400).json({ error: `surface must be one of: ${SURFACES.join(', ')}` });
    }
    if (healthcheck !== undefined && !HEALTHCHECKS.includes(healthcheck)) {
      return res.status(400).json({ error: `healthcheck must be one of: ${HEALTHCHECKS.join(', ')}` });
    }

    // Two shapes now (feat-services-containers-001). A container service has no
    // cwd or start command — Docker owns those — so validating them would make
    // registration impossible. Anything without an explicit type stays a host
    // process and keeps the original required fields.
    const isContainer = type === 'container';

    const services = getServices();
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    if (services.some((s) => s.id === id)) {
      return res.status(409).json({ error: `A service with id "${id}" already exists` });
    }

    let newService;
    if (isContainer) {
      const cname = (container_name || '').trim();
      if (!cname) return res.status(400).json({ error: 'Container name is required for a container service' });
      // Docker's own naming rules — reject early rather than 404ing on every
      // later start/stop with a name the daemon can never match.
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(cname)) {
        return res.status(400).json({ error: 'Container name may contain only letters, digits, _ . and -' });
      }
      // Port is informational for container services — the real published port
      // is read back from Docker on every status call.
      const safePort = port ? validatePort(port) : null;
      if (port && !safePort) return res.status(400).json({ error: 'Port must be a number between 1 and 65535' });
      newService = {
        id, name, group: group || 'Uncategorized', type: 'container',
        container_name: cname, port: safePort || 0, depends_on: depends_on || [],
      };
    } else {
      // A port is required only when the surface's health is probed over the
      // network (web/server/legacy). desktop/cli/job need none — that is what
      // retires the old `port: 0` workaround (feat-service-surfaces-001).
      const wantsPort = portRequired({ surface, healthcheck });
      if (!cwd || !startCmd) return res.status(400).json({ error: 'Working directory and start command are required' });
      let safePort = null;
      if (port !== undefined && port !== null && port !== '') {
        safePort = validatePort(port);
        if (!safePort) return res.status(400).json({ error: 'Port must be a number between 1 and 65535' });
      } else if (wantsPort) {
        return res.status(400).json({ error: 'Port is required for a web/server surface' });
      }
      const cmdCheck = validateStartCmd(startCmd);
      if (!cmdCheck.valid) return res.status(400).json({ error: cmdCheck.error });
      if (!validateCwd(cwd)) return res.status(400).json({ error: 'Working directory does not exist or is not a directory' });
      newService = { id, name, group: group || 'Uncategorized', type: 'process', cwd, startCmd: startCmd.trim(), depends_on: depends_on || [] };
      if (safePort !== null) newService.port = safePort;
      if (surface !== undefined) newService.surface = surface;
      if (healthcheck !== undefined) newService.healthcheck = healthcheck;
      if (env && typeof env === 'object' && !Array.isArray(env)) newService.env = env;
      if (autostart !== undefined) newService.autostart = !!autostart;
    }
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
router.put('/:id', requireServicesEnabled, (req, res) => {
  try {
    const services = getServices();
    const idx = services.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Service not found' });
    const { name, port, cwd, startCmd, group, depends_on, preview, surface, healthcheck, env, autostart } = req.body;

    if (surface !== undefined && !SURFACES.includes(surface)) return res.status(400).json({ error: `surface must be one of: ${SURFACES.join(', ')}` });
    if (healthcheck !== undefined && !HEALTHCHECKS.includes(healthcheck)) return res.status(400).json({ error: `healthcheck must be one of: ${HEALTHCHECKS.join(', ')}` });
    if (port !== undefined) { const p = validatePort(port); if (!p) return res.status(400).json({ error: 'Invalid port' }); services[idx].port = p; }
    if (startCmd !== undefined) { const c = validateStartCmd(startCmd); if (!c.valid) return res.status(400).json({ error: c.error }); services[idx].startCmd = startCmd.trim(); }
    if (cwd !== undefined) { if (!validateCwd(cwd)) return res.status(400).json({ error: 'Invalid working directory' }); services[idx].cwd = cwd; }
    if (name !== undefined) services[idx].name = name;
    if (group !== undefined) services[idx].group = group;
    if (depends_on !== undefined) services[idx].depends_on = depends_on;
    if (preview !== undefined) services[idx].preview = !!preview;
    if (surface !== undefined) services[idx].surface = surface;
    if (healthcheck !== undefined) services[idx].healthcheck = healthcheck;
    if (env !== undefined) { if (env && typeof env === 'object' && !Array.isArray(env)) services[idx].env = env; else return res.status(400).json({ error: 'env must be an object' }); }
    if (autostart !== undefined) services[idx].autostart = !!autostart;
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
router.post('/:id/restart', requireServicesEnabled, async (req, res) => {
  const services = getServices();
  const service = services.find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  // Container-backed services are driven through Docker, not spawn().
  const dispatched = await dockerDispatch(service, 'restart');
  if (dispatched) return res.status(dispatched.code).json(dispatched.payload);


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
router.delete('/:id', requireServicesEnabled, (req, res) => {
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
router.post('/:id/stop', requireServicesEnabled, async (req, res) => {
  const services = getServices();
  const service = services.find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  // Container-backed services are driven through Docker, not spawn().
  const dispatched = await dockerDispatch(service, 'stop');
  if (dispatched) return res.status(dispatched.code).json(dispatched.payload);

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
router.post('/:id/start', requireServicesEnabled, async (req, res) => {
  const services = getServices();
  const service = services.find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  // Container-backed services are driven through Docker, not spawn().
  const dispatched = await dockerDispatch(service, 'start');
  if (dispatched) return res.status(dispatched.code).json(dispatched.payload);

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
router.get('/:id/logs', async (req, res) => {
  // Container-backed services have no in-process log buffer — the logs live in
  // Docker's journal, so tail them from there instead.
  const service = getServices().find((s) => s.id === req.params.id);
  const dispatched = await dockerDispatch(service, 'logs');
  if (dispatched) return res.status(dispatched.code).json(dispatched.payload);

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
router.delete('/:id/logs', requireServicesEnabled, (req, res) => {
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
router.post('/groups/:name/start', requireServicesEnabled, async (req, res) => {
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
router.post('/groups/:name/stop', requireServicesEnabled, async (req, res) => {
  try {
    const services = getServices().filter(s => s.group === req.params.name);
    for (const service of services) { stopByPort(service.port, () => {}); }
    res.json({ success: true });
  } catch (error) { logger.error({ err: error }, 'Request failed'); res.status(500).json({ error: 'Internal server error' }); }
});

// Start services flagged `autostart: true`, in dependency order. Called once at
// boot from server.js. No-op when the Services feature is off (a container can't
// spawn host processes) or when nothing opts in — default `autostart` is false,
// so existing setups see no change (feat-service-surfaces-001).
const startAutostartServices = async () => {
  try {
    if (!servicesEnabled()) return;
    const auto = getServices().filter((s) => s.autostart && !isContainerService(s));
    if (!auto.length) return;
    logger.info({ count: auto.length }, 'Autostarting services');
    await startInOrder(auto);
  } catch (err) {
    logger.error({ err }, 'Autostart failed');
  }
};

module.exports = router;
module.exports.startAutostartServices = startAutostartServices;
