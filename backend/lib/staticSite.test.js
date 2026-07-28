// Unit tests for backend/lib/staticSite.js (devops-docker-serve-spa-001).
// The fallback predicate is the part worth pinning down: if it ever starts
// answering /api or /socket.io the frontend silently receives HTML where it
// expected JSON, which is a miserable bug to trace.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  resolveFrontendDist,
  isSpaFallbackRequest,
  hasBuild,
  cacheHeadersFor,
} = require('./staticSite');

const DEFAULT_DIST = '/srv/atrium/frontend/dist';

// --- resolveFrontendDist -------------------------------------------------

test('falls back to the repo dist directory when unset', () => {
  assert.strictEqual(resolveFrontendDist({ env: {}, defaultDir: DEFAULT_DIST }), DEFAULT_DIST);
});

test('ATRIUM_FRONTEND_DIST overrides the default', () => {
  const r = resolveFrontendDist({ env: { ATRIUM_FRONTEND_DIST: '/app/public' }, defaultDir: DEFAULT_DIST });
  assert.strictEqual(r, path.resolve('/app/public'));
});

test('a blank override falls back rather than resolving to cwd', () => {
  assert.strictEqual(resolveFrontendDist({ env: { ATRIUM_FRONTEND_DIST: '   ' }, defaultDir: DEFAULT_DIST }), DEFAULT_DIST);
});

// --- isSpaFallbackRequest ------------------------------------------------

test('serves the SPA for app routes and deep links', () => {
  assert.ok(isSpaFallbackRequest('GET', '/'));
  assert.ok(isSpaFallbackRequest('GET', '/board'));
  assert.ok(isSpaFallbackRequest('GET', '/tasks/feat-auth-001'));
  assert.ok(isSpaFallbackRequest('HEAD', '/graph'));
});

test('never shadows the API, websocket, docs, preview or design uploads', () => {
  for (const p of [
    '/api',
    '/api/tasks',
    '/api/health',
    '/api/docs',
    '/api/docs.json',
    '/api/preview/abc',
    '/api/design/uploads/x.png',
    '/api/design/prototypes/y.html',
    '/socket.io',
    '/socket.io/?EIO=4&transport=polling',
  ]) {
    assert.strictEqual(isSpaFallbackRequest('GET', p), false, `${p} must not hit the SPA fallback`);
  }
});

test('a path merely starting with the same letters is not reserved', () => {
  // '/apiary' shares a prefix with '/api' but is a legitimate app route.
  assert.ok(isSpaFallbackRequest('GET', '/apiary'));
  assert.ok(isSpaFallbackRequest('GET', '/socket.iota'));
});

test('non-GET verbs get a real 404 instead of an HTML page', () => {
  assert.strictEqual(isSpaFallbackRequest('POST', '/anything'), false);
  assert.strictEqual(isSpaFallbackRequest('PUT', '/anything'), false);
  assert.strictEqual(isSpaFallbackRequest('DELETE', '/anything'), false);
});

// --- hasBuild ------------------------------------------------------------

test('an unbuilt or empty dist reads as no build', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-dist-'));
  try {
    assert.strictEqual(hasBuild(empty), false, 'empty dir is not a build');
    assert.strictEqual(hasBuild(path.join(empty, 'nope')), false, 'missing dir is not a build');
    assert.strictEqual(hasBuild(null), false);

    fs.writeFileSync(path.join(empty, 'index.html'), '<!doctype html>');
    assert.strictEqual(hasBuild(empty), true);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

// --- cacheHeadersFor -----------------------------------------------------

test('index.html is never cached but hashed assets are immutable', () => {
  const dist = path.join('/srv', 'dist');
  const setHeaders = cacheHeadersFor(dist);
  const captured = {};
  const res = { setHeader: (k, v) => { captured[k] = v; } };

  setHeaders(res, path.join(dist, 'index.html'));
  assert.strictEqual(captured['Cache-Control'], 'no-cache');

  delete captured['Cache-Control'];
  setHeaders(res, path.join(dist, 'assets', 'index-BQ7mSF3s.js'));
  assert.strictEqual(captured['Cache-Control'], 'public, max-age=31536000, immutable');

  // Non-hashed top-level files keep express.static's default revalidation.
  delete captured['Cache-Control'];
  setHeaders(res, path.join(dist, 'favicon.svg'));
  assert.strictEqual(captured['Cache-Control'], undefined);
});
