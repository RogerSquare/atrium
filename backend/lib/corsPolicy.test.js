// Unit tests for backend/lib/corsPolicy.js (devops-docker-compose-001).
//
// The regression these pin down: a container published on an arbitrary host
// port served its own SPA, the browser sent Origin on login, and CORS rejected
// it because that port was not in the hardcoded list. Login was impossible and
// the error surfaced only in the server log.

const test = require('node:test');
const assert = require('node:assert');

const { isSameOrigin, buildAllowedOrigins, buildOriginChecker } = require('./corsPolicy');

// --- isSameOrigin --------------------------------------------------------

test('matches host and port exactly', () => {
  assert.ok(isSameOrigin('http://localhost:3100', 'localhost:3100'));
  assert.ok(isSameOrigin('https://board.example.com', 'board.example.com'));
});

test('a different port is NOT the same origin', () => {
  assert.strictEqual(isSameOrigin('http://localhost:3100', 'localhost:5173'), false);
});

test('a different host is NOT the same origin', () => {
  assert.strictEqual(isSameOrigin('http://evil.example.com', 'localhost:3100'), false);
});

test('localhost and 127.0.0.1 are distinct origins, as browsers treat them', () => {
  assert.strictEqual(isSameOrigin('http://127.0.0.1:3100', 'localhost:3100'), false);
});

test('case and surrounding whitespace do not matter', () => {
  assert.ok(isSameOrigin('http://LocalHost:3100', ' localhost:3100 '));
});

test('malformed or null origins are not same-origin', () => {
  // Sandboxed iframes and file:// pages send the literal string "null".
  for (const bad of ['null', 'not a url', '', undefined, null]) {
    assert.strictEqual(isSameOrigin(bad, 'localhost:3100'), false, `${bad} must not match`);
  }
  assert.strictEqual(isSameOrigin('http://localhost:3100', undefined), false);
});

// --- buildAllowedOrigins -------------------------------------------------

test('ALLOWED_ORIGINS entries are parsed and trimmed', () => {
  const o = buildAllowedOrigins({ ALLOWED_ORIGINS: 'https://a.test, https://b.test', NODE_ENV: 'production' });
  assert.ok(o.has('https://a.test'));
  assert.ok(o.has('https://b.test'));
});

test('dev localhost ports are auto-allowed outside production', () => {
  const o = buildAllowedOrigins({ NODE_ENV: 'development' });
  assert.ok(o.has('http://localhost:5173'), 'the Vite dev server is genuinely cross-origin');
  assert.ok(o.has('http://localhost:3001'));
});

test('production with a configured allowlist does not silently add localhost', () => {
  const o = buildAllowedOrigins({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://board.example.com' });
  assert.ok(o.has('https://board.example.com'));
  assert.strictEqual(o.has('http://localhost:5173'), false);
});

// --- buildOriginChecker --------------------------------------------------

test('THE REGRESSION: a container on an unlisted port allows its own SPA', () => {
  // Production, no ALLOWED_ORIGINS configured, published on host port 3100 —
  // exactly the `docker compose up` default. This previously threw.
  const allow = buildOriginChecker(buildAllowedOrigins({ NODE_ENV: 'production' }));
  assert.ok(allow('http://localhost:3100', 'localhost:3100'), 'same-origin must be allowed on any port');
  assert.ok(allow('http://127.0.0.1:3100', '127.0.0.1:3100'));
  assert.ok(allow('https://board.r-that.com', 'board.r-that.com'), 'and behind a proxy hostname too');
});

test('a genuine cross-origin request is still rejected', () => {
  const allow = buildOriginChecker(buildAllowedOrigins({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://ok.test' }));
  assert.strictEqual(allow('https://evil.test', 'localhost:3100'), false);
  assert.ok(allow('https://ok.test', 'localhost:3100'), 'explicitly allowlisted origins still pass');
});

test('requests with no Origin pass through (curl, server-to-server)', () => {
  const allow = buildOriginChecker(buildAllowedOrigins({ NODE_ENV: 'production' }));
  assert.ok(allow(undefined, 'localhost:3100'));
  assert.ok(allow('', 'localhost:3100'));
});

test('the dev split-port setup keeps working', () => {
  // Vite on 5173 calling the API on 3001 is cross-origin and must stay allowed
  // by the list, since the same-origin rule cannot cover it.
  const allow = buildOriginChecker(buildAllowedOrigins({ NODE_ENV: 'development' }));
  assert.ok(allow('http://localhost:5173', 'localhost:3001'));
});
