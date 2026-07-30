// Socket.IO handshake authentication (devops-socket-auth-001).
//
// Before this, `io.on('connection')` in server.js accepted ANY socket and
// immediately wired up PTY-spawning handlers (sockets/terminal.js,
// sockets/web-shell.js). On a server bound to 0.0.0.0 that is an
// unauthenticated interactive shell in the workspace for anyone who can reach
// the port. This `io.use()` middleware verifies the same JWTs the REST API
// requires (lib/authMiddleware.js) during the handshake, so an unauthenticated
// socket is rejected before it ever reaches a handler.
//
// The identity attached to `socket.user` matches the `req.user` shape from
// authMiddleware.js so a socket identity means the same thing as a REST one.
// The two are kept in sync by mirroring the same two token branches (user /
// agent) rather than sharing code, to avoid refactoring the battle-tested but
// currently untested authMiddleware in the same change.
//
// Escape hatch: ATRIUM_SOCKET_AUTH=off disables the check for one release so an
// operator who somehow depends on the old open behaviour has a documented,
// explicit opt-out instead of a surprise lockout. Remove it next release.

const jwt = require('jsonwebtoken');
const fs = require('fs');
const { JWT_SECRET, USERS_DIR, AGENT_TOKENS_BLOCKLIST } = require('./constants');
const { sanitizeFilename, safePath } = require('./sanitize');

// Mirrors lib/features.js OFF_VALUES: anything unrecognized (including unset)
// reads as ON, so a typo fails safe toward "authenticated" rather than open.
const OFF_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);

function socketAuthEnabled(env = process.env) {
  const raw = env && env.ATRIUM_SOCKET_AUTH;
  if (typeof raw !== 'string') return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}

// Pull the JWT out of a Socket.IO handshake. Browsers set it via
// io(url, { auth: { token } }) -> handshake.auth.token. An Authorization: Bearer
// header and a ?token= query param are also accepted so non-browser clients and
// the existing token-in-query pattern keep working.
function extractToken(handshake) {
  if (!handshake) return null;
  const authToken = handshake.auth && handshake.auth.token;
  if (authToken) return String(authToken).replace(/^Bearer\s+/i, '');
  const header = handshake.headers && handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
  const q = handshake.query && handshake.query.token;
  if (q) return String(q);
  return null;
}

// Revoked agent-token JTIs. Cheap JSON read; the list is tiny (revocations are
// rare). Falls back to empty on any error, exactly like authMiddleware.js.
function loadBlocklist(deps = {}) {
  const { existsSync = fs.existsSync, readFileSync = fs.readFileSync } = deps;
  try {
    if (!existsSync(AGENT_TOKENS_BLOCKLIST)) return new Set();
    const arr = JSON.parse(readFileSync(AGENT_TOKENS_BLOCKLIST, 'utf-8'));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

// Default user loader — reads USERS_DIR/<sanitized>.json, same as authMiddleware.
function defaultReadUser(username) {
  const safe = sanitizeFilename(username);
  const p = safe ? safePath(USERS_DIR, `${safe}.json`) : null;
  if (!p || !fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// Verify a token and return the socket.user object, or throw. Mirrors the two
// branches of authMiddleware.js requireAuth. Dependencies are injectable so the
// unit test never needs a real secret, a real user file, or the filesystem.
function verifyToken(token, deps = {}) {
  const {
    verify = (t) => jwt.verify(t, JWT_SECRET),
    blocklist = loadBlocklist(),
    readUser = defaultReadUser,
  } = deps;

  const decoded = verify(token);

  // Agent-token branch: long-lived, revocable via blocklist.
  if (decoded && decoded.agent === true) {
    if (!decoded.jti || !decoded.name) throw new Error('Malformed agent token');
    if (blocklist.has(decoded.jti)) throw new Error('Agent token revoked');
    return {
      username: `agent:${decoded.name}`,
      role: 'agent',
      can_run_agents: true,
      can_use_ai_chat: true,
      agent: true,
      agent_jti: decoded.jti,
    };
  }

  // User-token branch.
  const userData = readUser(decoded && decoded.username);
  if (!userData) throw new Error('User not found');
  return {
    username: userData.username,
    role: userData.role || 'member',
    can_run_agents: userData.can_run_agents || false,
    can_use_ai_chat: userData.can_use_ai_chat !== false,
  };
}

// The io.use() middleware factory. On success attaches socket.user and calls
// next(); on failure calls next(Error) so Socket.IO rejects the handshake and
// the client never reaches a connection handler.
function createSocketAuthMiddleware(deps = {}) {
  const {
    enabled = socketAuthEnabled(),
    verify = verifyToken,
    logger = null,
  } = deps;

  return (socket, next) => {
    if (!enabled) {
      // Explicit opt-out: allow the socket through with no identity. Nothing
      // currently reads socket.user, so null is safe; it is set for parity.
      socket.user = null;
      return next();
    }
    const token = extractToken(socket.handshake);
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = verify(token);
      return next();
    } catch (err) {
      if (logger && logger.warn) {
        logger.warn({ err: err.message, socketId: socket.id }, 'socket auth rejected');
      }
      return next(new Error('Authentication failed'));
    }
  };
}

module.exports = {
  createSocketAuthMiddleware,
  verifyToken,
  extractToken,
  socketAuthEnabled,
  loadBlocklist,
};
