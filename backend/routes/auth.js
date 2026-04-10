const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { USERS_DIR, JWT_SECRET } = require('../lib/constants');
const { sanitizeFilename, safePath } = require('../lib/sanitize');
const { logger } = require('../lib/logger');
const { requireAuth, requireAdmin } = require('../lib/authMiddleware');

const router = express.Router();

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
 *                 example: mypassword
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
 *                 minLength: 4
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
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
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

module.exports = router;
