// Unit tests for the Socket.IO handshake auth (devops-socket-auth-001).
// Pure: every dependency (token verify, user load, blocklist, enabled flag) is
// injected, so no real JWT, filesystem, or user file is touched.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createSocketAuthMiddleware,
  verifyToken,
  extractToken,
  socketAuthEnabled,
} = require('./socketAuth');

test('socketAuthEnabled defaults ON when unset', () => {
  assert.strictEqual(socketAuthEnabled({}), true);
  assert.strictEqual(socketAuthEnabled({ ATRIUM_SOCKET_AUTH: undefined }), true);
});

test('socketAuthEnabled reads OFF values, case/space-insensitive', () => {
  for (const v of ['off', 'OFF', ' false ', '0', 'no', 'disabled']) {
    assert.strictEqual(socketAuthEnabled({ ATRIUM_SOCKET_AUTH: v }), false, `"${v}" should disable`);
  }
});

test('socketAuthEnabled treats unrecognized values as ON (fail-safe)', () => {
  assert.strictEqual(socketAuthEnabled({ ATRIUM_SOCKET_AUTH: 'on' }), true);
  assert.strictEqual(socketAuthEnabled({ ATRIUM_SOCKET_AUTH: 'yes' }), true);
  assert.strictEqual(socketAuthEnabled({ ATRIUM_SOCKET_AUTH: 'typo' }), true);
});

test('extractToken reads handshake.auth.token, header, and query', () => {
  assert.strictEqual(extractToken({ auth: { token: 'abc' } }), 'abc');
  assert.strictEqual(extractToken({ auth: { token: 'Bearer abc' } }), 'abc');
  assert.strictEqual(extractToken({ headers: { authorization: 'Bearer xyz' } }), 'xyz');
  assert.strictEqual(extractToken({ query: { token: 'qtok' } }), 'qtok');
  assert.strictEqual(extractToken({}), null);
  assert.strictEqual(extractToken(null), null);
});

test('extractToken prefers auth.token over header over query', () => {
  const h = { auth: { token: 'A' }, headers: { authorization: 'Bearer B' }, query: { token: 'C' } };
  assert.strictEqual(extractToken(h), 'A');
});

test('verifyToken resolves a user token to the req.user-shaped identity', () => {
  const user = verifyToken('t', {
    verify: () => ({ username: 'alice' }),
    readUser: (name) => (name === 'alice' ? { username: 'alice', role: 'admin', can_run_agents: true } : null),
  });
  assert.strictEqual(user.username, 'alice');
  assert.strictEqual(user.role, 'admin');
  assert.strictEqual(user.can_run_agents, true);
  assert.strictEqual(user.agent, undefined);
});

test('verifyToken defaults role to member and can_use_ai_chat to true', () => {
  const user = verifyToken('t', {
    verify: () => ({ username: 'bob' }),
    readUser: () => ({ username: 'bob' }),
  });
  assert.strictEqual(user.role, 'member');
  assert.strictEqual(user.can_run_agents, false);
  assert.strictEqual(user.can_use_ai_chat, true);
});

test('verifyToken resolves an agent token', () => {
  const user = verifyToken('t', {
    verify: () => ({ agent: true, jti: 'j1', name: 'ci-bot' }),
  });
  assert.strictEqual(user.username, 'agent:ci-bot');
  assert.strictEqual(user.role, 'agent');
  assert.strictEqual(user.agent, true);
  assert.strictEqual(user.agent_jti, 'j1');
});

test('verifyToken rejects a malformed agent token (no jti)', () => {
  assert.throws(() => verifyToken('t', {
    verify: () => ({ agent: true, name: 'ci-bot' }),
  }), /Malformed agent token/);
});

test('verifyToken rejects a revoked agent token', () => {
  assert.throws(() => verifyToken('t', {
    verify: () => ({ agent: true, jti: 'revoked-1', name: 'ci-bot' }),
    blocklist: new Set(['revoked-1']),
  }), /revoked/);
});

test('verifyToken rejects when the user file is missing', () => {
  assert.throws(() => verifyToken('t', {
    verify: () => ({ username: 'ghost' }),
    readUser: () => null,
  }), /User not found/);
});

// --- middleware ---

function runMiddleware(mw, handshake) {
  const socket = { id: 'sock1', handshake };
  let nextArg = 'UNCALLED';
  mw(socket, (err) => { nextArg = err; });
  return { socket, nextArg };
}

test('middleware disabled: allows through with null identity', () => {
  const mw = createSocketAuthMiddleware({ enabled: false });
  const { socket, nextArg } = runMiddleware(mw, {});
  assert.strictEqual(nextArg, undefined, 'next() called with no error');
  assert.strictEqual(socket.user, null);
});

test('middleware enabled: rejects a socket with no token', () => {
  const mw = createSocketAuthMiddleware({ enabled: true, verify: () => ({ username: 'x' }) });
  const { socket, nextArg } = runMiddleware(mw, {});
  assert.ok(nextArg instanceof Error, 'next() called with an Error');
  assert.strictEqual(socket.user, undefined);
});

test('middleware enabled: accepts a valid token and attaches socket.user', () => {
  const mw = createSocketAuthMiddleware({
    enabled: true,
    verify: (t) => ({ username: 'alice', role: 'admin' }),
  });
  const { socket, nextArg } = runMiddleware(mw, { auth: { token: 'good' } });
  assert.strictEqual(nextArg, undefined);
  assert.deepStrictEqual(socket.user, { username: 'alice', role: 'admin' });
});

test('middleware enabled: rejects when verify throws', () => {
  const mw = createSocketAuthMiddleware({
    enabled: true,
    verify: () => { throw new Error('bad token'); },
  });
  const { socket, nextArg } = runMiddleware(mw, { auth: { token: 'bad' } });
  assert.ok(nextArg instanceof Error);
  assert.strictEqual(socket.user, undefined);
});
