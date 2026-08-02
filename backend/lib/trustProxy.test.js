// Unit tests for backend/lib/trustProxy.js (devops-harden-remote-001).
//
// Two layers: the env-string mapping, and the premise the mapping exists for —
// that req.ip (what express-rate-limit keys on) honors X-Forwarded-For exactly
// when the operator said there is a proxy, and ignores it when they didn't.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');

const { resolveTrustProxy } = require('./trustProxy');

// --- env mapping ---------------------------------------------------------

test('unset, empty, false, and 0 all mean OFF', () => {
  for (const v of [undefined, '', '  ', 'false', 'FALSE', '0']) {
    assert.strictEqual(resolveTrustProxy({ ATRIUM_TRUST_PROXY: v }), false, `${JSON.stringify(v)} must be off`);
  }
});

test('true means exactly one hop, never the permissive boolean', () => {
  assert.strictEqual(resolveTrustProxy({ ATRIUM_TRUST_PROXY: 'true' }), 1);
  assert.strictEqual(resolveTrustProxy({ ATRIUM_TRUST_PROXY: 'TRUE' }), 1);
});

test('integers are hop counts', () => {
  assert.strictEqual(resolveTrustProxy({ ATRIUM_TRUST_PROXY: '2' }), 2);
});

test('presets and subnets pass through verbatim', () => {
  assert.strictEqual(resolveTrustProxy({ ATRIUM_TRUST_PROXY: 'loopback' }), 'loopback');
  assert.strictEqual(resolveTrustProxy({ ATRIUM_TRUST_PROXY: '10.0.0.0/8' }), '10.0.0.0/8');
});

// --- rate-limit keying premise -------------------------------------------

// Boot a bare express app that echoes req.ip, hit it over real HTTP with a
// spoofed X-Forwarded-For, and check which address Express reports.
async function ipSeenBy(trustProxy) {
  const app = express();
  if (trustProxy !== false) app.set('trust proxy', trustProxy);
  app.get('/', (req, res) => res.json({ ip: req.ip }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();

  try {
    return await new Promise((resolve, reject) => {
      http.get(
        { host: '127.0.0.1', port, path: '/', headers: { 'X-Forwarded-For': '203.0.113.9' } },
        (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve(JSON.parse(body).ip));
        }
      ).on('error', reject);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('trust off: a spoofed X-Forwarded-For cannot change the rate-limit key', async () => {
  const ip = await ipSeenBy(false);
  assert.match(ip, /127\.0\.0\.1$/, `expected the socket address, got ${ip}`);
});

test('trust 1 hop: the forwarded client address becomes the rate-limit key', async () => {
  const ip = await ipSeenBy(resolveTrustProxy({ ATRIUM_TRUST_PROXY: 'true' }));
  assert.strictEqual(ip, '203.0.113.9');
});
