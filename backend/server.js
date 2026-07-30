const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

// --- Shared Config ---
const { PORT, TASKS_DIR, HISTORY_DIR, TRASH_DIR, ARCHIVED_DIR, USERS_DIR, SETTINGS_FILE, SERVICES_FILE, CHAT_DIR, CHAT_FILE } = require('./lib/constants');
const { setIO } = require('./lib/io');
const { logger, requestLogger } = require('./lib/logger');
const { resolveFrontendDist, isSpaFallbackRequest, hasBuild, cacheHeadersFor } = require('./lib/staticSite');
const { featureSnapshot } = require('./lib/features');
const { buildAllowedOrigins, buildOriginChecker } = require('./lib/corsPolicy');
const { buildInstanceInfo } = require('./lib/instanceInfo');
const { version: APP_VERSION } = require('./package.json');

// --- Swagger API Docs ---
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./lib/swagger');

// --- Auth Middleware ---
const { requireAuth, optionalAuth } = require('./lib/authMiddleware');

// --- Route Modules ---
const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const servicesRoutes = require('./routes/services');
const projectsRoutes = require('./routes/projects');
const tasksRoutes = require('./routes/tasks');
const { router: agentsRoutes, setIO: setAgentsIO } = require('./routes/agents');
const chatRoutes = require('./routes/chat');
const aiRoutes = require('./routes/ai');
const designRoutes = require('./routes/design');
const previewRoutes = require('./routes/preview');
const shellRoutes = require('./routes/shell');
const approvalsRoutes = require('./routes/approvals');
const githubRoutes = require('./routes/github');
const setupRoutes = require('./routes/setup');
const diagnosticsRoutes = require('./routes/diagnostics');
const loopsRoutes = require('./routes/loops');
const loopTemplatesRoutes = require('./routes/loopTemplates');
const loopManager = require('./lib/loopManager');
const e2eRunsRoutes = require('./routes/e2eRuns');
const demosRoutes = require('./routes/demos');
const autoEnterRoutes = require('./routes/autoenter');
const { router: autoEnterHookRoutes } = require('./routes/autoenterHook');

// --- Socket Handlers ---
const { registerChatHandlers, handleChatDisconnect } = require('./sockets/chat');
const { registerTerminalHandlers } = require('./sockets/terminal');
const { registerWebShellHandlers } = require('./sockets/web-shell');
const { registerPresenceHandlers, handlePresenceDisconnect, getAllTaskViewers } = require('./sockets/presence');
const { registerPreviewHandlers, handlePreviewDisconnect } = require('./sockets/preview');

// --- Express & Socket.IO Setup ---
const app = express();
const server = http.createServer(app);

// --- CORS Origin Policy ---
// Policy lives in lib/corsPolicy.js so the rules are unit-tested. In short:
// same-origin is always allowed (the Origin's host matches the Host header the
// browser used), plus anything in ALLOWED_ORIGINS, plus the dev localhost
// ports where Vite and the API genuinely differ.
//
// The same-origin rule is what makes the container work on any published port:
// it serves its own SPA, so `docker run -p 3100:3001` must not require the
// operator to also remember an ALLOWED_ORIGINS entry (devops-docker-compose-001).
const allowedOrigins = buildAllowedOrigins();
const isOriginAllowed = buildOriginChecker(allowedOrigins);

// The `cors` package's options-delegate form — `(req, callback)` rather than
// `(origin, callback)` — because deciding same-origin needs the Host header,
// which the origin-only signature does not expose.
const corsDelegate = (req, callback) => {
  const origin = req.headers.origin;
  if (isOriginAllowed(origin, req.headers.host)) {
    return callback(null, {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });
  }
  callback(new Error(`CORS: origin ${origin} not allowed`));
};

app.use(cors(corsDelegate));

// socket.io passes its `cors` option straight to the same package, so the
// delegate works here too and the two layers cannot drift apart.
const io = new Server(server, { cors: corsDelegate });

app.use(express.json());
app.use(requestLogger);

// --- Ensure Directories Exist ---
[TASKS_DIR, HISTORY_DIR, TRASH_DIR, ARCHIVED_DIR, USERS_DIR, CHAT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
// Seed settings.json on FIRST boot only. ATRIUM_WORKING_DIRECTORY lets the
// container point this at its bind-mounted /workspace without a manual edit
// inside the volume (devops-docker-compose-001). Existing settings are never
// overwritten — the user's choice in the UI always wins after first boot.
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
    workingDirectory: process.env.ATRIUM_WORKING_DIRECTORY || '',
  }));
}
if (!fs.existsSync(SERVICES_FILE)) fs.writeFileSync(SERVICES_FILE, JSON.stringify([]));
if (!fs.existsSync(CHAT_FILE)) fs.writeFileSync(CHAT_FILE, JSON.stringify([]));

// --- Cleanup stale temp files from previous crash ---
const { cleanupTempFiles } = require('./lib/tasks');
cleanupTempFiles();

// --- Share IO instance globally ---
setIO(io);
setAgentsIO(io);
const { setIO: setWebShellIO } = require('./sockets/web-shell');
setWebShellIO(io);

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 uptime:
 *                   type: number
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

/**
 * @swagger
 * /api/instance:
 *   get:
 *     summary: Instance identity for installers/clients
 *     description: >
 *       Name, version, listen port, and the URL the client actually reached
 *       (proxy-aware). Public so `atrium-mcp-setup` can probe the running
 *       instance and write MCP config for the real URL instead of assuming
 *       localhost:3001 (feat-mcp-bootstrap-001).
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Instance metadata
 */
app.get('/api/instance', (req, res) => {
  res.json(buildInstanceInfo({
    headers: req.headers,
    protocol: req.protocol,
    host: req.get('host'),
    port: PORT,
    version: APP_VERSION,
  }));
});

// Deep health/readiness check — verifies filesystem, memory
app.get('/api/health/ready', (req, res) => {
  const checks = {};
  let healthy = true;

  // 1. Filesystem: verify read/write access to TASKS_DIR
  try {
    const testFile = path.join(TASKS_DIR, '.health-check-tmp');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    checks.filesystem = { status: 'ok' };
  } catch (err) {
    checks.filesystem = { status: 'fail', error: 'Cannot read/write to tasks directory' };
    healthy = false;
  }

  // 2. Memory usage
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  checks.memory = { status: heapUsedMB < 512 ? 'ok' : 'warn', heapUsedMB, heapTotalMB, rssMB };

  // 3. Task count (verifies index/scan works)
  try {
    const { getAllTasks } = require('./lib/tasks');
    const count = getAllTasks(TASKS_DIR).length;
    checks.tasks = { status: 'ok', count };
  } catch (err) {
    checks.tasks = { status: 'fail', error: 'Cannot load tasks' };
    healthy = false;
  }

  // 4. Uptime
  checks.uptime = { seconds: Math.round(process.uptime()) };

  const statusCode = healthy ? 200 : 503;
  res.status(statusCode).json({ status: healthy ? 'ok' : 'degraded', checks });
});

/**
 * @swagger
 * /api/features:
 *   get:
 *     summary: Which optional features this instance offers
 *     description: >
 *       Feature flags for host-coupled surfaces. A containerized instance
 *       cannot spawn processes on its host, so the Services manager is
 *       typically disabled there. Public so the client can branch before
 *       authenticating; it exposes booleans only, no configuration.
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Map of feature name to enabled boolean
 */
app.get('/api/features', (req, res) => {
  res.json(featureSnapshot());
});

// --- API Documentation ---
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Atrium API Docs',
}));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// --- Rate Limiting ---
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' }
});

const batchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many batch operations, please try again later' }
});

// Apply global rate limit to API routes (excluding preview proxy which is asset-heavy)
app.use('/api', (req, res, next) => {
  // Skip rate limiting for preview proxy — a single page load triggers 30-50 asset requests
  if (req.path.startsWith('/preview/')) return next();
  globalLimiter(req, res, next);
});
// Strict rate limits on auth endpoints
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);
app.use('/api/change-password', authLimiter);
// Strict rate limits on batch operations
app.use('/api/tasks/batch', batchLimiter);

// --- Mount Routes ---
// Public: login, register (no auth required)
app.use('/api', authRoutes);
// Protected: all other routes require valid JWT
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/services', requireAuth, servicesRoutes);
app.use('/api/projects', requireAuth, projectsRoutes);
app.use('/api/tasks', requireAuth, tasksRoutes);
app.use('/api/approvals', requireAuth, approvalsRoutes);
app.use('/api/agents', requireAuth, agentsRoutes);
app.use('/api/chat', requireAuth, chatRoutes);
app.use('/api/ai', requireAuth, aiRoutes);
app.use('/api/design', requireAuth, designRoutes);
app.use('/api/preview', optionalAuth, previewRoutes);
app.use('/api/github', requireAuth, githubRoutes);
app.use('/api/setup', requireAuth, setupRoutes);
app.use('/api/diagnostics', requireAuth, diagnosticsRoutes);
app.use('/api/loops', requireAuth, loopsRoutes);
app.use('/api/loop-templates', requireAuth, loopTemplatesRoutes);
app.use('/api/shell', requireAuth, shellRoutes);
// e2e-runs handles auth per-endpoint so the artifact-file GET can accept ?token= for media tags.
app.use('/api/e2e-runs', e2eRunsRoutes);
// Demos route is metadata-only; the static demo files are served by Vite without auth.
app.use('/api/demos', requireAuth, demosRoutes);
// Auto-Enter Notification hook receiver (feat-autoenter-hook-signal-001).
// PUBLIC by design — the caller is the spawned `claude` process, which has
// no JWT; it self-authenticates with the ATRIUM_HOOK_TOKEN shared secret
// when configured. Mounted BEFORE the protected /api/autoenter so the
// more-specific /hook path bypasses requireAuth.
app.use('/api/autoenter/hook', autoEnterHookRoutes);
// Auto-Enter capture log — terminal toggle POSTs unrecognized prompts here for analysis.
app.use('/api/autoenter', requireAuth, autoEnterRoutes);

/**
 * @swagger
 * /api/presence:
 *   get:
 *     summary: Get current task viewers
 *     description: Returns which users are currently viewing which tasks (via Socket.IO presence).
 *     tags: [Presence]
 *     responses:
 *       200:
 *         description: Map of taskId to viewer arrays
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: array
 *                 items:
 *                   type: string
 */
app.get('/api/presence', (req, res) => {
  res.json(getAllTaskViewers());
});

// --- Built SPA (devops-docker-serve-spa-001) ---
// Mounted AFTER every /api route so it can never shadow one, and BEFORE the
// error handler, which must stay last. In development you normally hit Vite
// on :5173 (which proxies /api here) and this block simply never matches;
// in a container it is how the board is served at all.
const FRONTEND_DIST = resolveFrontendDist({
  defaultDir: path.join(__dirname, '..', 'frontend', 'dist'),
});

if (hasBuild(FRONTEND_DIST)) {
  // index: false so '/' falls through to the handler below and index.html is
  // served from exactly one place, with one set of headers.
  app.use(express.static(FRONTEND_DIST, {
    index: false,
    setHeaders: cacheHeadersFor(FRONTEND_DIST),
  }));

  // History fallback: unknown GETs are client-side routes, so hand back the
  // shell and let the router sort it out. Express 5 replaced path-to-regexp,
  // so `app.get('*')` no longer parses — this must be a bare app.use.
  app.use((req, res, next) => {
    if (!isSpaFallbackRequest(req.method, req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  logger.info({ dist: FRONTEND_DIST }, 'Serving built frontend');
} else {
  // Not a fatal condition: running the backend alone against Vite is the
  // normal dev setup. Say so plainly instead of 404ing into the void.
  logger.warn({ dist: FRONTEND_DIST }, 'No frontend build found — serving API only. Run `npm run build` in frontend/ to serve the SPA from this port.');

  app.use((req, res, next) => {
    if (!isSpaFallbackRequest(req.method, req.path)) return next();
    res.status(503).type('text/plain').send(
      'Atrium API is running, but no frontend build was found at:\n'
      + `  ${FRONTEND_DIST}\n\n`
      + 'Either run `npm run build` in frontend/, set ATRIUM_FRONTEND_DIST,\n'
      + 'or use the Vite dev server on :5173 for development.\n'
    );
  });
}

// --- Global Error Handler (safety net for unhandled route errors) ---
app.use((err, req, res, _next) => {
  logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled route error');
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Socket.IO Connection Handler ---
io.on('connection', (socket) => {
  logger.debug({ socketId: socket.id }, 'Socket connected');

  registerChatHandlers(io, socket);
  registerPresenceHandlers(io, socket);
  registerPreviewHandlers(io, socket);
  const cleanupTerminal = registerTerminalHandlers(socket);
  const cleanupWebShell = registerWebShellHandlers(socket);

  socket.on('disconnect', () => {
    cleanupTerminal();
    cleanupWebShell();
    handleChatDisconnect(io, socket);
    handlePresenceDisconnect(io, socket);
    handlePreviewDisconnect(io, socket);
    logger.debug({ socketId: socket.id }, 'Socket disconnected');
  });
});

// --- Start Server ---
server.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, `Backend server running on http://0.0.0.0:${PORT}`);
  logger.info({ features: featureSnapshot() }, 'Feature flags');
  logger.info(`API docs at http://localhost:${PORT}/api/docs`);
  // Start the GitHub-watcher loop engine after the server is listening so a
  // slow first poll never blocks startup (feat-loops-engine-001).
  try {
    loopManager.init();
  } catch (err) {
    logger.error({ err }, 'Failed to start loop engine');
  }
});
