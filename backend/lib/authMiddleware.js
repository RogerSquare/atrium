const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { JWT_SECRET, USERS_DIR } = require('./constants');
const { sanitizeFilename, safePath } = require('./sanitize');
const { logger } = require('./logger');

/**
 * requireAuth — rejects request with 401 if no valid JWT is present.
 * Attaches decoded user info to req.user.
 */
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { username } = decoded;

    // Load user data to attach role/permissions
    const safeUser = sanitizeFilename(username);
    const userFilePath = safeUser ? safePath(USERS_DIR, `${safeUser}.json`) : null;
    if (!userFilePath || !fs.existsSync(userFilePath)) {
      return res.status(401).json({ error: 'User not found' });
    }

    const userData = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
    req.user = {
      username: userData.username,
      role: userData.role || 'member',
      can_run_agents: userData.can_run_agents || false,
      can_use_ai_chat: userData.can_use_ai_chat !== false
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

/**
 * optionalAuth — attaches req.user if a valid JWT is present, but does NOT reject.
 * Useful for read-only routes that benefit from knowing the user.
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { username } = decoded;
    const safeUser = sanitizeFilename(username);
    const userFilePath = safeUser ? safePath(USERS_DIR, `${safeUser}.json`) : null;
    if (userFilePath && fs.existsSync(userFilePath)) {
      const userData = JSON.parse(fs.readFileSync(userFilePath, 'utf-8'));
      req.user = {
        username: userData.username,
        role: userData.role || 'member',
        can_run_agents: userData.can_run_agents || false,
        can_use_ai_chat: userData.can_use_ai_chat !== false
      };
    } else {
      req.user = null;
    }
  } catch (err) {
    req.user = null;
  }
  next();
};

/**
 * requireAdmin — must be used AFTER requireAuth.
 * Rejects with 403 if the user is not an admin.
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { requireAuth, optionalAuth, requireAdmin };
