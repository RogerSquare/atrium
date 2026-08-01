const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { USERS_DIR, JWT_SECRET, AGENT_TOKENS_DIR, AGENT_TOKENS_BLOCKLIST } = require('../lib/constants');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { logger } = require('../lib/logger');
const { requireAuth, requireAdmin } = require('../lib/authMiddleware');

// Ensure agent-tokens dir + blocklist exist at module load
if (!fs.existsSync(AGENT_TOKENS_DIR)) {
  try { fs.mkdirSync(AGENT_TOKENS_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}
if (!fs.existsSync(AGENT_TOKENS_BLOCKLIST)) {
  try { fs.writeFileSync(AGENT_TOKENS_BLOCKLIST, '[]'); } catch (e) { /* ignore */ }
}

const router = express.Router();

// Minimum for register + change-password (devops-harden-remote-001). Login is
// a bcrypt compare only, so accounts created under the old 4-char rule keep
// working — the policy bites on the next password change.
const MIN_PASSWORD_LENGTH = 12;

// Helper to check if any users exist (first user becomes admin)
const isFirstUser = () => {
  try {
    const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
    return files.length === 0;
  } catch (e) {
    return true;
  }
};

/**
 * @swagger
 * /api/register:
 *   post:
 *     summary: Register a new user
 *     description: First registered user automatically becomes admin. Subsequent users are members.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 example: RogerSquare
 *               password:
 *                 type: string
 *                 minLength: 12
 *                 example: correct-horse-battery
 *     responses:
 *       200:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    // 12-char minimum (devops-harden-remote-001) — this box is reachable over
    // LAN/tailnet, and register was previously the only door with NO length
    // check at all. Existing accounts are untouched (login never re-checks).
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const safeUser = sanitizeFilename(username);
    if (!safeUser || safeUser !== username) {
      return res.status(400).json({ error: 'Username contains invalid characters' });
    }
    const userFilePath = safePath(USERS_DIR, `${safeUser}.json`);
    if (!userFilePath) {
      return res.status(400).json({ error: 'Invalid username' });
    }
    if (fs.existsSync(userFilePath)) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const firstUser = isFirstUser();
    const hashedPassword = await bcrypt.hash(password, 10);
    const userData = {
      username,
      password: hashedPassword,
      role: firstUser ? 'admin' : 'member',
      can_run_agents: firstUser, // first user (admin) gets agent access by default
      can_use_ai_chat: true // AI chat enabled by default for all users
    };
    fs.writeFileSync(userFilePath, JSON.stringify(userData, null, 2));
    res.status(201).json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: Log in
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 username:
 *                   type: string
 *                 role:
 *                   type: string
 *                   enum: [admin, member]
 *                 can_run_agents:
 *                   type: boolean
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const safeUser = sanitizeFilename(username);
    const userFilePath = safeUser ? safePath(USERS_DIR, `${safeUser}.json`) : null;
    if (!userFilePath || !fs.existsSync(userFilePath)) {
      return res.status(400).json({ error: 'User not found' });
    }
    const userData = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
    const isPasswordValid = await bcrypt.compare(password, userData.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid password' });
    }
    // Track last login
    userData.last_login = new Date().toISOString();
    fs.writeFileSync(userFilePath, JSON.stringify(userData, null, 2));

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      success: true,
      token,
      username,
      role: userData.role || 'member',
      can_run_agents: userData.can_run_agents !== undefined ? userData.can_run_agents : false,
      can_use_ai_chat: userData.can_use_ai_chat !== undefined ? userData.can_use_ai_chat : true
    });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users (admin only — no auth middleware yet, so trust client for now)
/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     description: Returns all registered users. Admin only (no auth middleware yet).
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
    const users = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(USERS_DIR, f), 'utf-8'));
      return {
        username: data.username,
        role: data.role || 'member',
        can_run_agents: data.can_run_agents !== undefined ? data.can_run_agents : false,
        can_use_ai_chat: data.can_use_ai_chat !== undefined ? data.can_use_ai_chat : true,
        last_login: data.last_login || null
      };
    });
    res.json(users);
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user permissions (admin action)
/**
 * @swagger
 * /api/users/{username}:
 *   put:
 *     summary: Update user permissions
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, member]
 *               can_run_agents:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   $ref: '#/components/schemas/User'
 */
router.put('/users/:username', requireAuth, (req, res) => {
  try {
    const { username } = req.params;
    const { role, can_run_agents, can_use_ai_chat } = req.body;
    const isAdmin = req.user.role === 'admin';
    const isSelf = req.user.username === username;

    // Non-admins cannot modify other users
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Non-admins cannot change privileged fields (role, agent access)
    if (!isAdmin && (role !== undefined || can_run_agents !== undefined)) {
      return res.status(403).json({ error: 'Only admins can change roles and agent permissions' });
    }

    const safeUser = sanitizeFilename(username);
    const userFilePath = safeUser ? safePath(USERS_DIR, `${safeUser}.json`) : null;

    if (!userFilePath || !fs.existsSync(userFilePath)) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
    if (role !== undefined && isAdmin) userData.role = role;
    if (can_run_agents !== undefined && isAdmin) userData.can_run_agents = can_run_agents;
    if (can_use_ai_chat !== undefined) userData.can_use_ai_chat = can_use_ai_chat;
    fs.writeFileSync(userFilePath, JSON.stringify(userData, null, 2));

    res.json({ success: true, user: { username, role: userData.role, can_run_agents: userData.can_run_agents, can_use_ai_chat: userData.can_use_ai_chat } });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
/**
 * @swagger
 * /api/change-password:
 *   post:
 *     summary: Change password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, currentPassword, newPassword]
 *             properties:
 *               username:
 *                 type: string
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 12
 *     responses:
 *       200:
 *         description: Password changed
 */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    // Users can only change their own password
    if (req.user.username !== username) {
      return res.status(403).json({ error: 'Can only change your own password' });
    }
    if (!username || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const safeUser = sanitizeFilename(username);
    const userFilePath = safeUser ? safePath(USERS_DIR, `${safeUser}.json`) : null;
    if (!userFilePath || !fs.existsSync(userFilePath)) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userData = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
    const isValid = await bcrypt.compare(currentPassword, userData.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    userData.password = await bcrypt.hash(newPassword, 10);
    fs.writeFileSync(userFilePath, JSON.stringify(userData, null, 2));
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (admin only)
/**
 * @swagger
 * /api/users/{username}:
 *   delete:
 *     summary: Delete a user
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted
 */
router.delete('/users/:username', requireAuth, requireAdmin, (req, res) => {
  try {
    const { username } = req.params;
    // Prevent admin from deleting themselves
    if (req.user.username === username) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const safeUser = sanitizeFilename(username);
    const userFilePath = safeUser ? safePath(USERS_DIR, `${safeUser}.json`) : null;
    if (!userFilePath || !fs.existsSync(userFilePath)) {
      return res.status(404).json({ error: 'User not found' });
    }
    fs.unlinkSync(userFilePath);
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Agent Tokens ---
// Long-lived JWTs distinguished from user tokens by { agent: true, jti, name }.
// Non-expiring by default; optionally minted with expires_in_days.
// Revocation is by JTI in backend/agent-tokens/.blocklist.json.

const readBlocklist = () => {
  try {
    const arr = JSON.parse(fs.readFileSync(AGENT_TOKENS_BLOCKLIST, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
};
const writeBlocklist = (list) => {
  fs.writeFileSync(AGENT_TOKENS_BLOCKLIST, JSON.stringify(list, null, 2));
};

const readAgentTokensMeta = () => {
  try {
    const files = fs.readdirSync(AGENT_TOKENS_DIR)
      .filter(f => f.endsWith('.json') && !f.startsWith('.'));
    return files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(AGENT_TOKENS_DIR, f), 'utf-8')); } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) { return []; }
};

// POST /api/auth/agent-token — mint an agent token (admin-only). Token is returned ONCE.
// Optional body.expires_in_days (1–3650) mints an expiring token; jwt.verify in
// authMiddleware already 401s expired tokens, so no extra check is needed there.
// Omitted = non-expiring (unchanged default; revocation via blocklist). Rotation
// runbook: docs/security-remote.md (devops-harden-remote-001).
router.post('/agent-token', requireAuth, requireAdmin, (req, res) => {
  try {
    const rawName = (req.body?.name || '').trim();
    if (!rawName) return res.status(400).json({ error: 'name is required' });
    const name = sanitizeFilename(rawName);
    if (!name || name !== rawName) return res.status(400).json({ error: 'name contains invalid characters' });

    const rawDays = req.body?.expires_in_days;
    let expiresInDays = null;
    if (rawDays !== undefined && rawDays !== null && rawDays !== '') {
      const n = Number(rawDays);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        return res.status(400).json({ error: 'expires_in_days must be an integer between 1 and 3650' });
      }
      expiresInDays = n;
    }

    const jti = crypto.randomUUID();
    const issued_at = new Date().toISOString();
    const issued_by = req.user.username;

    const token = expiresInDays
      ? jwt.sign({ agent: true, jti, name, issued_by }, JWT_SECRET, { expiresIn: `${expiresInDays}d` })
      : jwt.sign({ agent: true, jti, name, issued_by }, JWT_SECRET);
    const expires_at = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Store metadata (not the token itself — the token is returned once and never persisted).
    const metaPath = safePath(AGENT_TOKENS_DIR, `${jti}.json`);
    if (!metaPath) return res.status(500).json({ error: 'Failed to derive token metadata path' });
    const meta = { jti, name, issued_at, issued_by, expires_at };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    res.status(201).json({ token, jti, name, issued_at, issued_by, expires_at });
  } catch (err) {
    logger.error({ err }, 'agent-token mint failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/agent-tokens — list metadata for issued tokens (admin-only). Token values are NOT returned.
router.get('/agent-tokens', requireAuth, requireAdmin, (req, res) => {
  try {
    const meta = readAgentTokensMeta();
    const blocklist = new Set(readBlocklist());
    const out = meta
      .map(m => ({ ...m, revoked: blocklist.has(m.jti) }))
      .sort((a, b) => (b.issued_at || '').localeCompare(a.issued_at || ''));
    res.json({ tokens: out });
  } catch (err) {
    logger.error({ err }, 'agent-tokens list failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/auth/agent-tokens/:jti — revoke an agent token (admin-only).
router.delete('/agent-tokens/:jti', requireAuth, requireAdmin, (req, res) => {
  try {
    const jti = sanitizeFilename(req.params.jti);
    if (!jti) return res.status(400).json({ error: 'Invalid jti' });

    const list = readBlocklist();
    if (!list.includes(jti)) {
      list.push(jti);
      writeBlocklist(list);
    }
    res.json({ ok: true, jti });
  } catch (err) {
    logger.error({ err }, 'agent-token revoke failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/verify — lightweight validation endpoint for the MCP setup CLI.
// Returns 200 + basic identity info if the bearer token is valid (user OR agent).
router.get('/verify', requireAuth, (req, res) => {
  res.json({
    ok: true,
    username: req.user.username,
    role: req.user.role,
    agent: !!req.user.agent,
  });
});

module.exports = router;
