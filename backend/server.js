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
const e2eRunsRoutes = require('./routes/e2eRuns');
const demosRoutes = require('./routes/demos');

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
// In production, set ALLOWED_ORIGINS env var (comma-separated list of origins)
// In development, localhost origins are auto-allowed
const buildAllowedOrigins = () => {
  const origins = new Set();
  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean).forEach(o => origins.add(o));
  }
  // Always allow same-origin (empty origin from non-browser clients / same-host)
  // Auto-allow localhost variants in development
  if (process.env.NODE_ENV !== 'production' || origins.size === 0) {
    [3000, 3001, 5173, 5174, 8080].forEach(p => {
      origins.add(`http://localhost:${p}`);
      origins.add(`http://127.0.0.1:${p}`);
    });
  }
  // Playwright's hosted trace viewer fetches our /api/e2e-runs/.../trace.zip
  // when a reviewer clicks "Open in Playwright trace viewer" on a Tests-tab
  // spec row. The viewer is a Microsoft-hosted SPA that opens any trace URL
  // passed via ?trace=. Allowing it here keeps the cross-origin fetch from
  // the viewer-page to atrium from being rejected.
  origins.add('https://trace.playwright.dev');
  return origins;
};

const allowedOrigins = buildAllowedOrigins();

const corsOriginCheck = (origin, callback) => {
  // Allow requests with no origin (same-origin, curl, server-to-server)
  if (!origin) return callback(null, true);
  if (allowedOrigins.has(origin)) return callback(null, true);
  callback(new Error(`CORS: origin ${origin} not allowed`));
};

app.use(cors({
  origin: corsOriginCheck,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => corsOriginCheck(origin, callback),
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(express.json());
app.use(requestLogger);

// --- Ensure Directories Exist ---
[TASKS_DIR, HISTORY_DIR, TRASH_DIR, ARCHIVED_DIR, USERS_DIR, CHAT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ workingDirectory: '' }));
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
app.use('/api/shell', requireAuth, shellRoutes);
// e2e-runs handles auth per-endpoint so the artifact-file GET can accept ?token= for media tags.
app.use('/api/e2e-runs', e2eRunsRoutes);
// Demos route is metadata-only; the static demo files are served by Vite without auth.
app.use('/api/demos', requireAuth, demosRoutes);

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
  logger.info(`API docs at http://localhost:${PORT}/api/docs`);
});
